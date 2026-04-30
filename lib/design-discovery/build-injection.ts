import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY — generation-time context injection.
//
// PR 10. Reads sites.{design_*, tone_of_voice*} for a given site
// and returns a string to prepend to a generation system prompt.
// Wrapped in the DESIGN_CONTEXT_ENABLED feature flag — when off,
// returns the empty string and the caller's existing behaviour is
// preserved exactly.
//
// Injection shape:
//
//   <design_context>
//   tokens: { primary, secondary, ... }
//   homepage_reference (truncated to 2000 chars):
//   <html...>
//   </design_context>
//
//   <voice_context>
//   style_guide: ...
//   on_brand_examples:
//   - hero: ...
//   - service: ...
//   - blog: ...
//   </voice_context>
//
// Either block is omitted entirely when its status column != 'approved'.
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
  design_direction_status: string | null;
  tone_of_voice_status: string | null;
  design_tokens: Record<string, unknown> | null;
  homepage_concept_html: string | null;
  tone_applied_homepage_html: string | null;
  tone_of_voice: Record<string, unknown> | null;
}

export async function loadSiteDesignContext(
  siteId: string,
): Promise<SiteContextRow | null> {
  if (!isDesignContextEnabled()) return null;
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .select(
      "design_direction_status, tone_of_voice_status, design_tokens, homepage_concept_html, tone_applied_homepage_html, tone_of_voice",
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

export function renderInjection(row: SiteContextRow | null): string {
  if (!row) return "";
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
export async function buildDesignContextPrefix(
  siteId: string,
): Promise<string> {
  if (!isDesignContextEnabled()) return "";
  const row = await loadSiteDesignContext(siteId);
  return renderInjection(row);
}
