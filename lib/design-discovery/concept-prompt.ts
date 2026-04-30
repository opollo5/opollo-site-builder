// DESIGN-DISCOVERY — concept generation prompt template.
//
// One Anthropic call per direction (Minimal / Dense / Editorial).
// The system + user message bundle is constructed here so it can be
// unit-tested without touching the SDK. The model + constraints in
// here MUST stay aligned with the spec — every constraint listed in
// the workstream brief lives below verbatim.

import type { DesignBrief } from "@/lib/design-discovery/design-brief";

export type ConceptDirection = "minimal" | "dense" | "editorial";

const DIRECTIONS: Record<
  ConceptDirection,
  { label: string; description: string }
> = {
  minimal: {
    label: "Minimal",
    description:
      "High whitespace, restrained color palette, typography-led hierarchy, premium feel. Lean toward 1 dominant heading style and ~3 colors used. Generous section padding.",
  },
  dense: {
    label: "Conversion",
    description:
      "Conversion-focused, card-heavy, strong CTAs, information-rich layout. Multiple cards per row; bold CTA buttons; visible value props above the fold; quick scanning over deep reading.",
  },
  editorial: {
    label: "Editorial",
    description:
      "Bold headings, image-placeholder-led, magazine-style layout, expressive typography. Big hero type, mixed type weights, asymmetric grids welcomed.",
  },
};

export function directionLabel(d: ConceptDirection): string {
  return DIRECTIONS[d].label;
}

const CONCEPT_SYSTEM_PROMPT = `You are a senior web designer at a top agency working on a marketing site for a client. The operator (your project lead) has captured a design brief from the client. You produce ONE creative direction at a time, in a strict structured format. Your output MUST be valid JSON wrapped in <output>...</output> tags.

You generate inline-CSS HTML — no external dependencies except Google Fonts via @import at the top of the <style> tag. No <script> tags. Class names follow a "ls-" prefix to avoid colliding with the host site.

Constraints (NON-NEGOTIABLE):
- Max 2 font families across the entire concept.
- Max 5 colors total — use design_tokens.{primary, secondary, accent, background, text} only. Reference these as CSS variables (--c-primary, --c-secondary, --c-accent, --c-bg, --c-text).
- One consistent border_radius value used throughout. Reference as --radius.
- Hero font-size: 48–72px desktop (clamp(32px, 5vw, 72px) is acceptable), 32–48px mobile.
- H2 font-size: 28–36px.
- Body font-size: 16–18px.
- Line length on prose blocks: max 70ch.
- All section padding values must be multiples of 8px.
- Min 64px vertical padding between sections on desktop.
- Inline CSS only via <style>...</style> at the top of each HTML block.

Homepage HTML — exactly 6 sections in this order:
1. <section class="ls-hero"> — headline, subheadline, primary CTA button
2. <section class="ls-value-prop"> — 3 key points
3. <section class="ls-services"> — exactly 3 service cards
4. <section class="ls-social-proof"> — logo placeholders OR a testimonial card
5. <section class="ls-cta"> — heading + button
6. <footer class="ls-footer"> — brand mark, copyright, minimal nav

Inner page HTML — exactly 5 sections in this order:
1. <header class="ls-page-header"> — title + breadcrumb (Home > Page)
2. <section class="ls-intro"> — single intro paragraph
3. <section class="ls-content"> — 2 to 3 content blocks each with H2 + body
4. <section class="ls-cta"> — CTA block (matches homepage tokens)
5. <footer class="ls-footer"> — same shape as homepage

Micro UI snippets (for the review card preview):
- micro_ui.button: a single <button> in the same style as the hero CTA
- micro_ui.card: a single service card snippet
- micro_ui.input: a single labelled <input> with placeholder text

Output strictly the JSON below, wrapped in <output>...</output>. No prose outside the tags. Do not add any explanation outside the rationale field.

{
  "rationale": "1–2 sentence design rationale.",
  "design_tokens": {
    "primary": "#...",
    "secondary": "#...",
    "accent": "#...",
    "background": "#...",
    "text": "#...",
    "font_heading": "FontName",
    "font_body": "FontName",
    "border_radius": "8px",
    "spacing_unit": "8px"
  },
  "homepage_html": "<style>@import url(...); .ls-hero {...}</style><section class=\\"ls-hero\\">...</section>...<footer class=\\"ls-footer\\">...</footer>",
  "inner_page_html": "<style>...</style><header class=\\"ls-page-header\\">...</header>...<footer class=\\"ls-footer\\">...</footer>",
  "micro_ui": {
    "button": "<button class=\\"ls-btn\\">...</button>",
    "card": "<div class=\\"ls-card\\">...</div>",
    "input": "<label class=\\"ls-input\\">...<input ... /></label>"
  }
}`;

export function buildConceptUserMessage(
  brief: DesignBrief,
  direction: ConceptDirection,
  siteName: string,
): string {
  const d = DIRECTIONS[direction];
  const lines: string[] = [];
  lines.push(`Site: ${siteName}`);
  lines.push(`Direction: ${d.label} — ${d.description}`);
  lines.push("");
  lines.push("Design brief from the operator:");
  lines.push(`- Industry: ${brief.industry}`);
  if (brief.reference_url) {
    lines.push(`- Reference URL: ${brief.reference_url}`);
  }
  if (brief.existing_site_url) {
    lines.push(`- Existing site URL: ${brief.existing_site_url}`);
  }
  if (brief.description) {
    lines.push(`- Description: ${brief.description}`);
  }
  if (brief.edited_understanding) {
    lines.push(`- Operator-edited understanding: ${brief.edited_understanding}`);
  }
  if (brief.refinement_notes && brief.refinement_notes.length > 0) {
    lines.push(`- Refinement notes (apply these): ${brief.refinement_notes.join(" | ")}`);
  }
  if (brief.extracted) {
    const e = brief.extracted;
    if (e.swatches.length > 0) {
      lines.push(`- Auto-extracted swatches (use as starting point): ${e.swatches.join(", ")}`);
    }
    if (e.fonts.length > 0) {
      lines.push(`- Auto-extracted fonts (use as starting point): ${e.fonts.join(", ")}`);
    }
    if (e.layout_tags.length > 0) {
      lines.push(`- Auto-extracted layout tags: ${e.layout_tags.join(", ")}`);
    }
    if (e.visual_tone_tags.length > 0) {
      lines.push(`- Auto-extracted visual tone: ${e.visual_tone_tags.join(", ")}`);
    }
  }
  lines.push("");
  lines.push(
    "Generate the ${d.label} direction now. Remember: exactly 6 homepage sections in the listed order, exactly 5 inner-page sections, max 2 fonts, max 5 colors, consistent --radius, all padding in multiples of 8px. Output strictly the JSON wrapped in <output>...</output>.",
  );
  return lines.join("\n");
}

export function getConceptSystemPrompt(): string {
  return CONCEPT_SYSTEM_PROMPT;
}

export const ALL_DIRECTIONS: ConceptDirection[] = [
  "minimal",
  "dense",
  "editorial",
];
