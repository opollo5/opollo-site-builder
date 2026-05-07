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

// Spec 03 PR 3 — operator-calibrated blog content classes injected
// alongside <existing_theme_context> for content_type='post' runs on
// copy_existing sites. Stored on extracted_design.blog_styling.
interface BlogStylingRow {
  source_blog_urls?: string[];
  article_container?: string | null;
  paragraph?: string | null;
  link_in_body?: string | null;
  blockquote?: string | null;
  unordered_list?: string | null;
  ordered_list?: string | null;
  list_item?: string | null;
  figure?: string | null;
  figcaption?: string | null;
  code_inline?: string | null;
  code_block?: string | null;
  hr?: string | null;
  article_h2?: string | null;
  article_h3?: string | null;
  article_h4?: string | null;
}

const BLOG_BUCKET_FALLBACK_TAGS: Record<keyof BlogStylingRow, string> = {
  source_blog_urls: "",
  article_container: "<article>",
  paragraph: "<p>",
  link_in_body: "",
  blockquote: "<blockquote>",
  unordered_list: "<ul>",
  ordered_list: "<ol>",
  list_item: "<li>",
  figure: "<figure>",
  figcaption: "<figcaption>",
  code_inline: "<code>",
  code_block: "<pre><code>",
  hr: "<hr>",
  article_h2: "<h2>",
  article_h3: "<h3>",
  article_h4: "<h4>",
};

function renderBlogClassLine(
  key: keyof BlogStylingRow,
  value: string | null | undefined,
): string {
  if (key === "source_blog_urls") return "";
  if (typeof value === "string" && value.length > 0) {
    return `${key}: .${value}`;
  }
  if (key === "link_in_body") {
    return `${key}: (none)`;
  }
  const fallbackTag = BLOG_BUCKET_FALLBACK_TAGS[key];
  return `${key}: (none — use plain ${fallbackTag})`;
}

function renderBlogContentClassesBlock(blog: BlogStylingRow): string {
  const orderedKeys: Array<keyof BlogStylingRow> = [
    "article_container",
    "paragraph",
    "link_in_body",
    "blockquote",
    "unordered_list",
    "ordered_list",
    "list_item",
    "figure",
    "figcaption",
    "code_inline",
    "code_block",
    "hr",
    "article_h2",
    "article_h3",
    "article_h4",
  ];
  const lines: string[] = [
    "<blog_content_classes>",
    "When generating blog post content (long-form articles), use these existing CSS classes",
    "on the matching elements. Drop the `.` prefix when applying as className. If a bucket",
    "is null, fall back to plain semantic tags without a class.",
    "",
  ];
  for (const key of orderedKeys) {
    const value = blog[key];
    lines.push(renderBlogClassLine(key, value as string | null | undefined));
  }
  lines.push("");
  lines.push(
    "These classes were extracted from your existing blog posts. Use them verbatim — do",
  );
  lines.push(
    "not invent variants. Do not introduce inline CSS for elements that have a class above.",
  );
  lines.push("</blog_content_classes>");
  return lines.join("\n");
}

function blogStylingHasUsableData(
  blog: BlogStylingRow | null | undefined,
): blog is BlogStylingRow {
  if (!blog || typeof blog !== "object") return false;
  if (
    Array.isArray(blog.source_blog_urls) &&
    blog.source_blog_urls.length === 0
  ) {
    // Operator submitted but extraction produced nothing — bucket
    // values still count if any were filled in manually.
    const bucketKeys: Array<keyof BlogStylingRow> = [
      "article_container",
      "paragraph",
      "link_in_body",
      "blockquote",
      "unordered_list",
      "ordered_list",
      "list_item",
      "figure",
      "figcaption",
      "code_inline",
      "code_block",
      "hr",
      "article_h2",
      "article_h3",
      "article_h4",
    ];
    return bucketKeys.some(
      (k) => typeof blog[k] === "string" && (blog[k] as string).length > 0,
    );
  }
  if (!Array.isArray(blog.source_blog_urls)) return false;
  // At least one bucket must have a non-null value to be useful.
  const bucketKeys: Array<keyof BlogStylingRow> = [
    "article_container",
    "paragraph",
    "link_in_body",
    "blockquote",
    "unordered_list",
    "ordered_list",
    "list_item",
    "figure",
    "figcaption",
    "code_inline",
    "code_block",
    "hr",
    "article_h2",
    "article_h3",
    "article_h4",
  ];
  return bucketKeys.some(
    (k) => typeof blog[k] === "string" && (blog[k] as string).length > 0,
  );
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

function renderCopyExistingInjection(
  row: SiteContextRow,
  contentType?: "post" | "page",
): string {
  const design = (row.extracted_design ?? null) as
    | {
        colors?: Record<string, string | null>;
        fonts?: Record<string, string | null>;
        layout_density?: string | null;
        visual_tone?: string | null;
        blog_styling?: BlogStylingRow | null;
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

  // Spec 03 PR 3 — append <blog_content_classes> for content_type='post'
  // runs only, alongside (not instead of) the landing-page block.
  // Pages still need landing-page class context; posts need both.
  if (
    contentType === "post" &&
    design?.blog_styling &&
    blogStylingHasUsableData(design.blog_styling)
  ) {
    const blogBlock = renderBlogContentClassesBlock(design.blog_styling);
    return `${lines.join("\n")}\n${blogBlock}`;
  }

  return lines.join("\n");
}

export function renderInjection(
  row: SiteContextRow | null,
  contentType?: "post" | "page",
): string {
  if (!row) return "";

  // copy_existing pathway runs regardless of DESIGN_CONTEXT_ENABLED —
  // it's gated by site_mode itself, which is only set after the
  // operator opts in via /onboarding.
  if (row.site_mode === "copy_existing") {
    return renderCopyExistingInjection(row, contentType) + "\n\n";
  }

  // new_design pathway — preserve the original DESIGN-DISCOVERY
  // behaviour, including the flag gate.
  if (row.site_mode === "new_design" && !isDesignContextEnabled()) {
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
  contentType?: "post" | "page",
): Promise<string> {
  const row = await loadSiteDesignContext(siteId);
  if (!row) return "";
  if (row.site_mode === "copy_existing") {
    return renderInjection(row, contentType);
  }
  if (row.site_mode === "new_design") {
    if (!isDesignContextEnabled()) return "";
    return renderInjection(row, contentType);
  }
  // site_mode IS NULL — preserve the pre-PR-10 fallback exactly so a
  // half-onboarded site doesn't suddenly start pulling discovery
  // context.
  if (!isDesignContextEnabled()) return "";
  return renderInjection(row, contentType);
}
