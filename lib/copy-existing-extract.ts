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
  /**
   * Spec 03 — calibrated blog post styling for copy_existing sites.
   * Optional. Populated by extractBlogStyling() when the operator
   * provides 1–3 blog URLs in the wizard. Consumed by the runner via
   * lib/design-discovery/build-injection.ts when content_type='post'.
   */
  blog_styling?: BlogStyling | null;
}

export interface BlogStyling {
  source_blog_urls: string[];
  // Article container
  article_container: string | null;
  // Body content classes
  paragraph: string | null;
  link_in_body: string | null;
  // Long-form structural elements
  blockquote: string | null;
  unordered_list: string | null;
  ordered_list: string | null;
  list_item: string | null;
  figure: string | null;
  figcaption: string | null;
  code_inline: string | null;
  code_block: string | null;
  hr: string | null;
  // Heading classes inside articles
  article_h2: string | null;
  article_h3: string | null;
  article_h4: string | null;
  // Diagnostics
  notes: string[];
  extracted_at: string;
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

// ---------------------------------------------------------------------------
// Spec 03 — blog-styling extraction.
//
// Extends the existing extractor with a second pass that fetches up to
// 3 operator-supplied blog post URLs, locates the article container,
// and pulls per-bucket class names for paragraphs, headings, lists,
// blockquotes, etc.
//
// Locked design choices (per spec):
//   - fetch() only, 8s timeout each. No headless browser.
//   - Same-origin filter via registrable-domain check (Public Suffix
//     List inlined as a hand-rolled multi-part TLD list — covers all
//     conventional customer domains; documented limitation below).
//   - Article container: first selector wins among
//     <article>, <main>, .post-content, .entry-content, .single-post-content
//   - Per-element regex tally with utility-class filtering to leave
//     a single semantic class per bucket.
//   - Cross-URL consistency rules per spec §1.2.
// ---------------------------------------------------------------------------

const BLOG_FETCH_TIMEOUT_MS = 8000;

// Limitation: hand-rolled registrable-domain detection. Edge-case
// domains (github.io, appspot.com, *.cloudfront.net, etc.) may
// misclassify. Conventional customer registrable domains work fine.
const MULTI_PART_TLDS = new Set<string>([
  "co.uk",
  "co.nz",
  "co.za",
  "com.au",
  "com.br",
  "com.mx",
  "com.sg",
  "com.hk",
  "co.jp",
  "co.kr",
  "co.in",
  "ac.uk",
  "gov.uk",
  "ac.nz",
  "net.au",
  "org.au",
  "org.uk",
]);

export function registrableDomainOf(rawUrl: string): string | null {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  // Multi-part TLD: registrable = last 3 labels.
  if (MULTI_PART_TLDS.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

// Article container selectors, in priority order. First match wins.
const ARTICLE_CONTAINER_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "article", regex: /<article\b[^>]*>([\s\S]*?)<\/article>/i },
  { name: "main", regex: /<main\b[^>]*>([\s\S]*?)<\/main>/i },
  {
    name: ".post-content",
    regex: /<(div|section)\b[^>]*\bclass="[^"]*\bpost-content\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i,
  },
  {
    name: ".entry-content",
    regex: /<(div|section)\b[^>]*\bclass="[^"]*\bentry-content\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i,
  },
  {
    name: ".single-post-content",
    regex: /<(div|section)\b[^>]*\bclass="[^"]*\bsingle-post-content\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/i,
  },
];

const UTILITY_CLASS_PATTERNS: RegExp[] = [
  /^(m|p|mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py)-/,
  /^(w|h|min-w|min-h|max-w|max-h)-/,
  /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)$/,
  /^font-(thin|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^(bg|border|rounded|shadow)-/,
  /^(flex|grid|gap|space|items|justify|content|self|order)-?/,
  /^(sm|md|lg|xl|2xl):/,
];

function isUtilityClass(cls: string): boolean {
  if (cls.length < 4) return true;
  if (/^[a-z]$/.test(cls)) return true;
  return UTILITY_CLASS_PATTERNS.some((p) => p.test(cls));
}

/** From a single class="…" string, return the surviving longest semantic class. */
function pickSemanticClass(classAttr: string): string | null {
  const classes = Array.from(
    new Set(classAttr.split(/\s+/).map((c) => c.trim()).filter(Boolean)),
  );
  const survivors = classes.filter((c) => !isUtilityClass(c));
  if (survivors.length === 0) return null;
  // Longest by character length wins; ties broken by lexical for determinism.
  survivors.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return a.localeCompare(b);
  });
  return survivors[0];
}

/**
 * Tally semantic-survivor classes across every match of `pattern` in
 * the container HTML. Returns the most frequent class, ties broken by
 * length then lexical.
 */
function tallyBucketClasses(
  containerHtml: string,
  pattern: RegExp,
): string | null {
  const counts = new Map<string, number>();
  pattern.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(containerHtml))) {
    const classAttr = m[1];
    if (!classAttr) continue;
    const winner = pickSemanticClass(classAttr);
    if (!winner) continue;
    counts.set(winner, (counts.get(winner) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0]);
  });
  return sorted[0][0];
}

interface BucketResult {
  article_container: string | null;
  paragraph: string | null;
  link_in_body: string | null;
  blockquote: string | null;
  unordered_list: string | null;
  ordered_list: string | null;
  list_item: string | null;
  figure: string | null;
  figcaption: string | null;
  code_inline: string | null;
  code_block: string | null;
  hr: string | null;
  article_h2: string | null;
  article_h3: string | null;
  article_h4: string | null;
}

const EMPTY_BUCKETS: BucketResult = {
  article_container: null,
  paragraph: null,
  link_in_body: null,
  blockquote: null,
  unordered_list: null,
  ordered_list: null,
  list_item: null,
  figure: null,
  figcaption: null,
  code_inline: null,
  code_block: null,
  hr: null,
  article_h2: null,
  article_h3: null,
  article_h4: null,
};

const BUCKET_KEYS = Object.keys(EMPTY_BUCKETS) as (keyof BucketResult)[];

interface PerUrlBuckets {
  ok: true;
  url: string;
  buckets: BucketResult;
}
interface PerUrlFailure {
  ok: false;
  url: string;
  reason: string;
}
type PerUrlResult = PerUrlBuckets | PerUrlFailure;

async function fetchWithTimeout(
  url: string,
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), BLOG_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Opollo-Site-Builder/1.0 (+https://opollo.com) Blog-Styling-Extract",
        },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return { ok: false, reason: `HTTP ${res.status}` };
      }
      const html = await res.text();
      return { ok: true, html };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : String(err);
    if (/abort/i.test(reason)) {
      return { ok: false, reason: "timed out after 8s" };
    }
    return { ok: false, reason };
  }
}

function extractBucketsFromHtml(html: string): {
  buckets: BucketResult;
  containerSelectorMatched: string | null;
  containerByteSize: number;
  childCount: number;
} {
  let containerHtml: string | null = null;
  let matchedName: string | null = null;
  for (const pattern of ARTICLE_CONTAINER_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const match = pattern.regex.exec(html);
    if (match) {
      // Two capture groups in the .post-content / .entry-content / .single-post-content
      // patterns; one group in <article>/<main>. The container HTML is the LAST
      // group matched.
      containerHtml = match[match.length - 1];
      matchedName = pattern.name;
      break;
    }
  }

  if (!containerHtml) {
    return {
      buckets: { ...EMPTY_BUCKETS },
      containerSelectorMatched: null,
      containerByteSize: 0,
      childCount: 0,
    };
  }

  // Diagnostic counts for the structured log.
  const childMatches = containerHtml.match(/<[a-zA-Z][^>]*>/g) ?? [];

  // Outer-container class picked off the OPENING tag of the matched
  // container. Re-find it on the original html (match[0] is the full
  // outer tag for these regexes).
  let outerOpening: string | null = null;
  for (const pattern of ARTICLE_CONTAINER_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const fullMatch = pattern.regex.exec(html);
    if (fullMatch && pattern.name === matchedName) {
      outerOpening = fullMatch[0].slice(
        0,
        fullMatch[0].indexOf(">") + 1,
      );
      break;
    }
  }
  let articleContainer: string | null = null;
  if (outerOpening) {
    const classAttrMatch = /\bclass\s*=\s*"([^"]+)"/i.exec(outerOpening);
    if (classAttrMatch) {
      articleContainer = pickSemanticClass(classAttrMatch[1]);
    }
  }

  // Per-bucket class regex. Match the OPENING tag's class attribute.
  // Anchor-link inside paragraph regex requires the <a> to live inside
  // a <p>; we approximate with a window-pattern that requires <p> to
  // appear within the preceding 200 chars — robust enough for the
  // structural HTML we see on real blog posts.
  const buckets: BucketResult = {
    ...EMPTY_BUCKETS,
    article_container: articleContainer,
  };

  buckets.paragraph = tallyBucketClasses(
    containerHtml,
    /<p\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.blockquote = tallyBucketClasses(
    containerHtml,
    /<blockquote\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.unordered_list = tallyBucketClasses(
    containerHtml,
    /<ul\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.ordered_list = tallyBucketClasses(
    containerHtml,
    /<ol\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.list_item = tallyBucketClasses(
    containerHtml,
    /<li\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.figure = tallyBucketClasses(
    containerHtml,
    /<figure\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.figcaption = tallyBucketClasses(
    containerHtml,
    /<figcaption\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.code_inline = tallyBucketClasses(
    containerHtml,
    /<code\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.code_block = tallyBucketClasses(
    containerHtml,
    /<pre\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.hr = tallyBucketClasses(
    containerHtml,
    /<hr\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.article_h2 = tallyBucketClasses(
    containerHtml,
    /<h2\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.article_h3 = tallyBucketClasses(
    containerHtml,
    /<h3\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );
  buckets.article_h4 = tallyBucketClasses(
    containerHtml,
    /<h4\b[^>]*\bclass\s*=\s*"([^"]+)"/gi,
  );

  // Link-in-body: tally class on <a> only when preceded by <p in a
  // small window. Cheap heuristic; avoids site-chrome <a> tags.
  buckets.link_in_body = tallyLinkInBody(containerHtml);

  return {
    buckets,
    containerSelectorMatched: matchedName,
    containerByteSize: containerHtml.length,
    childCount: childMatches.length,
  };
}

function tallyLinkInBody(containerHtml: string): string | null {
  const counts = new Map<string, number>();
  // Match <a class="..."> only when inside the article container AND
  // preceded by <p within 400 chars (so we mostly capture body links,
  // not chrome links). The container is already the article body so
  // most <a> tags qualify; the windowed check just filters out the
  // rare top-of-container "Back to articles" affordance.
  const linkRegex = /<a\b[^>]*\bclass\s*=\s*"([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(containerHtml))) {
    const idx = m.index;
    const window = containerHtml.slice(Math.max(0, idx - 400), idx);
    if (!/<p\b/i.test(window)) continue;
    const winner = pickSemanticClass(m[1]);
    if (!winner) continue;
    counts.set(winner, (counts.get(winner) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0]);
  });
  return sorted[0][0];
}

/**
 * Merge per-URL bucket results using the spec's cross-URL consistency
 * rules: 3-of-3 take, 2-of-3 majority + note, 1 take + low-confidence
 * note, all-differ leave null + note.
 */
function mergeBuckets(
  per: PerUrlBuckets[],
  notes: string[],
): BucketResult {
  const merged: BucketResult = { ...EMPTY_BUCKETS };
  for (const key of BUCKET_KEYS) {
    const values = per
      .map((p) => p.buckets[key])
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (values.length === 0) {
      merged[key] = null;
      continue;
    }
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    if (per.length === 1) {
      merged[key] = top[0];
      continue;
    }
    if (top[1] === per.length) {
      merged[key] = top[0];
      continue;
    }
    if (top[1] > per.length / 2) {
      merged[key] = top[0];
      notes.push(
        `Inconsistent ${key} class — ${top[1]}/${per.length} agreed; using majority "${top[0]}"`,
      );
      continue;
    }
    merged[key] = null;
    notes.push(
      `Inconsistent ${key} classes across blogs — leaving null`,
    );
  }
  return merged;
}

export interface ExtractBlogStylingResult {
  blog_styling: BlogStyling;
  notes: string[];
}

/**
 * Extract blog-content class names from up to 3 operator-supplied blog
 * URLs. Same-origin (registrable-domain) only. Returns merged bucket
 * results plus notes describing per-URL outcomes and cross-URL merge
 * decisions.
 */
export async function extractBlogStyling(
  primaryUrl: string,
  blogUrls: string[],
): Promise<ExtractBlogStylingResult> {
  const notes: string[] = [];
  const primaryDomain = registrableDomainOf(primaryUrl);
  if (!primaryDomain) {
    notes.push(`Primary URL ${primaryUrl} is not a parseable URL.`);
  }

  // Filter same-origin (registrable-domain), cap at 3.
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const raw of blogUrls) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (accepted.length >= 3) {
      notes.push(`Ignored extra blog URL beyond the 3-URL cap: ${trimmed}`);
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    const dom = registrableDomainOf(trimmed);
    if (!dom) {
      notes.push(`Ignored blog URL (not a valid URL): ${trimmed}`);
      continue;
    }
    if (primaryDomain && dom !== primaryDomain) {
      notes.push(
        `Ignored blog URL on different registrable domain (${dom}): ${trimmed}`,
      );
      continue;
    }
    accepted.push(trimmed);
  }

  if (accepted.length === 0) {
    return {
      blog_styling: {
        source_blog_urls: [],
        ...EMPTY_BUCKETS,
        notes,
        extracted_at: new Date().toISOString(),
      },
      notes,
    };
  }

  // Fetch each URL with timeout; collect results.
  const results = await Promise.all(
    accepted.map(async (url, idx): Promise<PerUrlResult> => {
      const fetchRes = await fetchWithTimeout(url);
      if (!fetchRes.ok) {
        notes.push(`URL ${idx + 1} failed to load: ${fetchRes.reason}`);
        return { ok: false, url, reason: fetchRes.reason };
      }
      const extracted = extractBucketsFromHtml(fetchRes.html);
      logger.info("copy-existing-extract.blog_styling.url_extracted", {
        url,
        container_selector: extracted.containerSelectorMatched,
        container_bytes: extracted.containerByteSize,
        child_count: extracted.childCount,
      });
      if (!extracted.containerSelectorMatched) {
        notes.push(
          `URL ${idx + 1} (${url}): no recognised article container — skipped.`,
        );
        return {
          ok: false,
          url,
          reason: "no article container",
        };
      }
      return { ok: true, url, buckets: extracted.buckets };
    }),
  );

  const successful = results.filter(
    (r): r is PerUrlBuckets => r.ok,
  );

  if (successful.length === 0) {
    return {
      blog_styling: {
        source_blog_urls: accepted,
        ...EMPTY_BUCKETS,
        notes,
        extracted_at: new Date().toISOString(),
      },
      notes,
    };
  }

  if (successful.length === 1 && accepted.length > 1) {
    notes.push(
      "Single-URL extraction — confidence is low; consider providing 2 more blog URLs",
    );
  } else if (successful.length === 1) {
    notes.push(
      "Single-URL extraction — confidence is low; consider providing 2 more blog URLs",
    );
  }

  const merged = mergeBuckets(successful, notes);

  return {
    blog_styling: {
      source_blog_urls: accepted,
      ...merged,
      notes: [...notes],
      extracted_at: new Date().toISOString(),
    },
    notes,
  };
}
