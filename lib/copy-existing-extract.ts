import "server-only";

import { extractCssFromUrl } from "@/lib/design-discovery/extract-css";
import { fetchMicrolinkScreenshot } from "@/lib/design-discovery/microlink";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// DESIGN-SYSTEM-OVERHAUL PR 7 — copy-existing extraction orchestrator.
//
// Produces the design-profile snapshot used to populate
// sites.extracted_design + sites.extracted_css_classes when an
// operator picks "Upload to existing site" during onboarding.
//
// This is an HTML/CSS-first extraction. Microlink supplies a
// screenshot URL when reachable; the vision call is intentionally
// deferred — extract-css.ts already produces strong colour / font /
// tone signals from the response HTML alone, and the Sonnet vision
// pass that the new_design wizard uses on operator-uploaded
// screenshots is overkill for an automated rip of a public site.
// A future slice can add a vision pass behind a flag if the v1
// signals turn out to under-sample on JS-heavy sites.
//
// CSS class detection is a regex pass over `class="..."` attributes
// in the response HTML, grouped into the four buckets the generation
// prompt cares about: container, heading levels, button, card.
// Cheap, deterministic, no external dep.
// ---------------------------------------------------------------------------

export interface ExtractedDesign {
  colors: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    text: string | null;
  };
  fonts: {
    heading: string | null;
    body: string | null;
  };
  layout_density: "compact" | "medium" | "spacious";
  visual_tone: string;
  screenshot_url: string | null;
  source_pages: string[];
}

export interface ExtractedCssClasses {
  container: string | null;
  headings: {
    h1: string | null;
    h2: string | null;
    h3: string | null;
  };
  button: string | null;
  card: string | null;
}

export interface ExtractionResult {
  ok: boolean;
  design: ExtractedDesign;
  css_classes: ExtractedCssClasses;
  notes: string[];
}

const CLASS_ATTR_RE = /class\s*=\s*"([^"]+)"/gi;
const HEADING_TAG_RE = /<h([1-3])\b[^>]*class\s*=\s*"([^"]+)"/gi;

function tally<T>(list: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const v of list) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

function topByPattern(
  classCounts: Map<string, number>,
  patterns: RegExp[],
): string | null {
  const matches: Array<[string, number]> = [];
  for (const [cls, count] of classCounts.entries()) {
    if (patterns.some((p) => p.test(cls))) matches.push([cls, count]);
  }
  matches.sort((a, b) => b[1] - a[1]);
  return matches[0]?.[0] ?? null;
}

function extractCssClasses(html: string): ExtractedCssClasses {
  const allClasses: string[] = [];
  let m: RegExpExecArray | null;
  CLASS_ATTR_RE.lastIndex = 0;
  while ((m = CLASS_ATTR_RE.exec(html))) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls) allClasses.push(cls);
    }
  }
  const counts = tally(allClasses);

  const headingByLevel: Record<"h1" | "h2" | "h3", string | null> = {
    h1: null,
    h2: null,
    h3: null,
  };
  HEADING_TAG_RE.lastIndex = 0;
  const headingTally = {
    h1: new Map<string, number>(),
    h2: new Map<string, number>(),
    h3: new Map<string, number>(),
  };
  while ((m = HEADING_TAG_RE.exec(html))) {
    const level = `h${m[1]}` as "h1" | "h2" | "h3";
    for (const cls of m[2].split(/\s+/)) {
      if (!cls) continue;
      headingTally[level].set(cls, (headingTally[level].get(cls) ?? 0) + 1);
    }
  }
  for (const lvl of ["h1", "h2", "h3"] as const) {
    const sorted = [...headingTally[lvl].entries()].sort((a, b) => b[1] - a[1]);
    headingByLevel[lvl] = sorted[0]?.[0] ?? null;
  }

  return {
    container: topByPattern(counts, [/container/i, /wrapper/i, /\bwrap\b/i, /content-area/i]),
    headings: headingByLevel,
    button: topByPattern(counts, [/\bbtn\b/i, /button/i, /\bcta\b/i]),
    card: topByPattern(counts, [/\bcard\b/i, /tile/i, /feature(?!d)/i]),
  };
}

function pickColor(swatches: string[], position: number): string | null {
  return swatches[position] ?? null;
}

function deriveLayoutDensity(html: string): "compact" | "medium" | "spacious" {
  const lower = html.toLowerCase();
  // Heuristic: count top-level <section> markers + line-heights /
  // padding hints. Not authoritative; the operator review step lets
  // the operator override.
  const sectionCount = (lower.match(/<section\b/g) ?? []).length;
  const generousPadding = /padding[^;]*1[2-9][0-9]px|padding[^;]*[2-9][0-9][0-9]px/.test(
    lower,
  );
  const tightPadding = /padding[^;]*[1-9]px|padding[^;]*1[0-5]px/.test(lower);
  if (generousPadding || sectionCount >= 6) return "spacious";
  if (tightPadding && sectionCount <= 3) return "compact";
  return "medium";
}

function deriveVisualTone(toneTags: string[]): string {
  if (toneTags.length === 0) return "Neutral";
  return toneTags[0];
}

export async function extractDesignFromUrl(
  url: string,
  options: { existingPages?: string[] } = {},
): Promise<ExtractionResult> {
  const notes: string[] = [];
  // Same-origin filter on the operator-supplied extra-pages list.
  // UAT (2026-05-02) — operators occasionally pasted URLs from other
  // sites into the extra-pages textarea, and those would land in
  // sites.extracted_design.source_pages even though the extractor only
  // ever fetches the primary URL. The result was a misleading "Source
  // pages" list on the appearance panel showing third-party hosts as
  // if they were part of this customer's design surface.
  let primaryOrigin: string | null = null;
  try {
    primaryOrigin = new URL(url).origin;
  } catch {
    // primary URL bad — extractCssFromUrl will surface the failure
    // properly; just skip the filter so the rest of the pipeline runs.
  }
  const filteredExtras: string[] = [];
  for (const extra of options.existingPages ?? []) {
    try {
      const u = new URL(extra);
      if (primaryOrigin && u.origin === primaryOrigin) {
        filteredExtras.push(extra);
      } else if (primaryOrigin) {
        notes.push(
          `Ignored extra page ${extra} — different origin from ${primaryOrigin}.`,
        );
      } else {
        // No primary origin to compare against — accept defensively.
        filteredExtras.push(extra);
      }
    } catch {
      notes.push(`Ignored extra page (not a valid URL): ${extra}`);
    }
  }
  const sourcePages = [url, ...filteredExtras];

  let cssResult;
  try {
    cssResult = await extractCssFromUrl(url);
  } catch (err) {
    logger.error("copy-existing-extract.css_failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      design: emptyDesign(url),
      css_classes: emptyCssClasses(),
      notes: [
        `CSS extraction failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    };
  }

  if (!cssResult.fetch_ok) {
    notes.push(`Site fetch failed: ${cssResult.fetch_error ?? "unknown"}.`);
    return {
      ok: false,
      design: emptyDesign(url),
      css_classes: emptyCssClasses(),
      notes,
    };
  }

  // Microlink screenshot — best-effort. If it fails the rest of the
  // extraction still lands.
  const screenshot = await fetchMicrolinkScreenshot(url);
  if (!screenshot.ok) {
    notes.push(`Microlink unavailable: ${screenshot.error ?? "no detail"}.`);
  }

  // Re-fetch HTML for class scan — extract-css.ts doesn't expose its
  // raw HTML buffer. Cheap (browsers cache, our outbound is unrelated)
  // and lets the class detection run against the same surface as the
  // colour extraction.
  let html = "";
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Opollo-Site-Builder/1.0 (+https://opollo.com) Design-Discovery",
      },
    });
    if (res.ok) html = await res.text();
  } catch {
    // Soft-fail; class extraction will return null buckets which the
    // generation pipeline treats as "use plain tags".
  }

  const cssClasses = extractCssClasses(html);

  const design: ExtractedDesign = {
    colors: {
      primary: pickColor(cssResult.swatches, 0),
      secondary: pickColor(cssResult.swatches, 1),
      accent: pickColor(cssResult.swatches, 2),
      background: pickColor(cssResult.swatches, 3) ?? "#ffffff",
      text: pickColor(cssResult.swatches, 4) ?? "#111111",
    },
    fonts: {
      heading: cssResult.fonts[0] ?? null,
      body: cssResult.fonts[1] ?? cssResult.fonts[0] ?? null,
    },
    layout_density: deriveLayoutDensity(html),
    visual_tone: deriveVisualTone(cssResult.visual_tone_tags),
    screenshot_url: screenshot.screenshot_url,
    source_pages: sourcePages,
  };

  return {
    ok: true,
    design,
    css_classes: cssClasses,
    notes,
  };
}

function emptyDesign(url: string): ExtractedDesign {
  return {
    colors: { primary: null, secondary: null, accent: null, background: null, text: null },
    fonts: { heading: null, body: null },
    layout_density: "medium",
    visual_tone: "Neutral",
    screenshot_url: null,
    source_pages: [url],
  };
}

function emptyCssClasses(): ExtractedCssClasses {
  return {
    container: null,
    headings: { h1: null, h2: null, h3: null },
    button: null,
    card: null,
  };
}
