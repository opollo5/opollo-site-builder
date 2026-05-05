import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY — generation-time context injection.
//
// PR 10 (DESIGN-DISCOVERY) — original new_design pathway.
// PR 10 (DESIGN-SYSTEM-OVERHAUL) — added the copy_existing pathway.
//
// Reads sites.* for a given site and returns a string to prepend to
// a generation system prompt. Behaviour now depends on site_mode:
//
//   site_mode = 'new_design'   → existing design-discovery injection
//                                (design_tokens / homepage_concept_html /
//                                tone_of_voice). Gated by
//                                DESIGN_CONTEXT_ENABLED — the flag
//                                preserves the previous opt-in posture.
//
//   site_mode = 'copy_existing'→ injects sites.extracted_design +
//                                sites.extracted_css_classes (PR 7
//                                output) and instructs the model to
//                                use the extracted class names rather
//                                than emit fresh CSS. NOT gated by
//                                DESIGN_CONTEXT_ENABLED — copy_existing
//                                only ships once a site has explicitly
//                                onboarded into that mode, so the flag
//                                isn't the right gate.
//
//   site_mode IS NULL          → empty string. Caller's previous
//                                behaviour preserved.
//
// Cost: typically 500–2000 additional input tokens per generation
// call. The brief runner's per-pass token budget already accounts
// for system-prompt growth; the M3 batch worker tracks input_tokens
// in its cost calculator and rolls them up as you'd expect.
// ---------------------------------------------------------------------------

const HTML_TRUNCATE_BYTES = 2000;

export function isDesignContextEnabled(): boolean {
  return process.env.DESIGN_CONTEXT_ENABLED === "true";
}

interface SiteContextRow {
  site_mode: string | null;
  design_direction_status: string | null;
  tone_of_voice_status: string | null;
  design_tokens: Record<string, unknown> | null;
  homepage_concept_html: string | null;
  tone_applied_homepage_html: string | null;
  tone_of_voice: Record<string, unknown> | null;
  extracted_design: Record<string, unknown> | null;
  extracted_css_classes: Record<string, unknown> | null;
}

export async function loadSiteDesignContext(
  siteId: string,
): Promise<SiteContextRow | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .select(
      "site_mode, design_direction_status, tone_of_voice_status, design_tokens, homepage_concept_html, tone_applied_homepage_html, tone_of_voice, extracted_design, extracted_css_classes",
    )
    .eq("id", siteId)
    .neq("status", "removed")
    .maybeSingle();
  if (error) {
    logger.warn("design-discovery.injection.load-failed", {
      site_id: siteId,
      message: error.message,
    });
    return null;
  }
  if (!data) return null;
  return data as SiteContextRow;
}

function tokensSummary(tokens: Record<string, unknown> | null): string {
  if (!tokens) return "";
  const keep = [
    "primary",
    "secondary",
    "accent",
    "background",
    "text",
    "font_heading",
    "font_body",
    "border_radius",
    "spacing_unit",
  ];
  const lines: string[] = [];
  for (const k of keep) {
    const v = tokens[k];
    if (typeof v === "string") {
      lines.push(`  ${k}: ${v}`);
    }
  }
  return lines.join("\n");
}

function samplesBlock(tone: Record<string, unknown>): string {
  const arr = tone.approved_samples;
  if (!Array.isArray(arr)) return "";
  const out: string[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const k = (item as Record<string, unknown>).kind;
    const t = (item as Record<string, unknown>).text;
    if (typeof t !== "string" || typeof k !== "string") continue;
    out.push(`- ${k}: ${t}`);
  }
  return out.join("\n");
}

function renderCopyExistingInjection(row: SiteContextRow): string {
  const design = (row.extracted_design ?? null) as
    | {
        colors?: Record<string, string | null>;
        fonts?: Record<string, string | null>;
        layout_density?: string | null;
        visual_tone?: string | null;
      }
    | null;
  const classes = (row.extracted_css_classes ?? null) as
    | {
        container?: string | null;
        headings?: { h1?: string | null; h2?: string | null; h3?: string | null };
        button?: string | null;
        card?: string | null;
      }
    | null;

  if (!design && !classes) return "";

  const lines: string[] = ["<existing_theme_context>"];
  lines.push(
    "This site has a live WordPress theme. Generated content must blend in seamlessly — do NOT introduce new CSS classes or inline styles unless absolutely necessary; the host theme handles styling.",
  );

  if (design?.colors) {
    const c = design.colors;
    const colorLines = (
      ["primary", "secondary", "accent", "background", "text"] as const
    )
      .map((key) => (c[key] ? `  ${key}: ${c[key]}` : null))
      .filter((line): line is string => line !== null);
    if (colorLines.length > 0) {
      lines.push("colors:");
      lines.push(...colorLines);
    }
  }

  if (design?.fonts) {
    const f = design.fonts;
    const fontLines = (["heading", "body"] as const)
      .map((key) => (f[key] ? `  ${key}: ${f[key]}` : null))
      .filter((line): line is string => line !== null);
    if (fontLines.length > 0) {
      lines.push("fonts:");
      lines.push(...fontLines);
    }
  }

  if (design?.layout_density || design?.visual_tone) {
    lines.push(
      `layout: ${design.layout_density ?? "medium"} · tone: ${
        design.visual_tone ?? "Neutral"
      }`,
    );
  }

  if (classes) {
    const classLines: string[] = [];
    if (classes.container) classLines.push(`  container: .${classes.container}`);
    if (classes.headings?.h1) classLines.push(`  h1: .${classes.headings.h1}`);
    if (classes.headings?.h2) classLines.push(`  h2: .${classes.headings.h2}`);
    if (classes.headings?.h3) classLines.push(`  h3: .${classes.headings.h3}`);
    if (classes.button) classLines.push(`  button: .${classes.button}`);
    if (classes.card) classLines.push(`  card: .${classes.card}`);
    if (classLines.length > 0) {
      lines.push(
        "Use these existing CSS classes (drop the .) on the matching elements:",
      );
      lines.push(...classLines);
    }
  }

  lines.push(
    "If a bucket above is missing, fall back to plain semantic tags without a class.",
  );
  lines.push("</existing_theme_context>");
  return lines.join("\n");
}

export function renderInjection(row: SiteContextRow | null): string {
  if (!row) return "";

  // copy_existing pathway runs regardless of DESIGN_CONTEXT_ENABLED —
  // it's gated by site_mode itself, which is only set after the
  // operator opts in via /onboarding.
  if (row.site_mode === "copy_existing") {
    return renderCopyExistingInjection(row) + "\n\n";
  }

  // new_design pathway — preserve the original DESIGN-DISCOVERY
  // behaviour, including the flag gate.
  if (row.site_mode !== "new_design" && !isDesignContextEnabled()) {
    return "";
  }

  const blocks: string[] = [];

  if (row.design_direction_status === "approved") {
    const tokens = tokensSummary(row.design_tokens);
    const refHtml =
      row.tone_applied_homepage_html ?? row.homepage_concept_html ?? "";
    const truncated = refHtml.slice(0, HTML_TRUNCATE_BYTES);
    const designLines = ["<design_context>"];
    if (tokens) {
      designLines.push("tokens:");
      designLines.push(tokens);
    }
    if (truncated) {
      designLines.push("homepage_reference (truncated):");
      designLines.push(truncated);
    }
    designLines.push("</design_context>");
    if (designLines.length > 2) {
      blocks.push(designLines.join("\n"));
    }
  }

  if (
    row.tone_of_voice_status === "approved" &&
    row.tone_of_voice &&
    typeof row.tone_of_voice === "object"
  ) {
    const tone = row.tone_of_voice;
    const styleGuide =
      typeof tone.style_guide === "string" ? tone.style_guide : "";
    const samples = samplesBlock(tone);
    const voiceLines = ["<voice_context>"];
    if (styleGuide) {
      voiceLines.push("style_guide:");
      voiceLines.push(styleGuide);
    }
    if (samples) {
      voiceLines.push("on_brand_examples:");
      voiceLines.push(samples);
    }
    voiceLines.push("</voice_context>");
    if (voiceLines.length > 2) {
      blocks.push(voiceLines.join("\n"));
    }
  }

  return blocks.length > 0 ? blocks.join("\n\n") + "\n\n" : "";
}

// Convenience: load + render in one call. Most callers want this.
//
// Dispatch:
//   site_mode = 'copy_existing' → always runs (mode itself is the gate).
//   site_mode = 'new_design'    → runs when DESIGN_CONTEXT_ENABLED is on.
//   site_mode IS NULL           → empty string (no caller-visible change
//                                  vs the pre-PR-10 behaviour).
//
// Returns "" on early exit so callers don't have to pre-check.
export async function buildDesignContextPrefix(
  siteId: string,
): Promise<string> {
  const row = await loadSiteDesignContext(siteId);
  if (!row) return "";
  if (row.site_mode === "copy_existing") return renderInjection(row);
  if (row.site_mode === "new_design") {
    if (!isDesignContextEnabled()) return "";
    return renderInjection(row);
  }
  // site_mode IS NULL — preserve the pre-PR-10 fallback exactly so a
  // half-onboarded site doesn't suddenly start pulling discovery
  // context.
  if (!isDesignContextEnabled()) return "";
  return renderInjection(row);
}
