import {
  HTML_SIZE_MAX_BYTES,
  checkHtmlSize,
} from "@/lib/html-size";

// ---------------------------------------------------------------------------
// M3-5 — Runtime quality gates.
//
// Runs between Anthropic's response and the WP publish. First failure
// short-circuits: slot → state='failed', reason logged, no further
// gate checks. This mirrors the HC-1..HC-7 hard constraints from
// SCOPE_v3 applied as a second-layer runtime check on top of the
// system prompt's generation-time rules. Scope: catch mis-generations
// before they mutate a production WP site.
//
// Gates shipping in M3-5:
//
//   wrapper            HC-2 — the outermost element carries
//                             data-ds-version="<version>".
//   scope_prefix       HC-4 — every class in the HTML matches the
//                             site's /^<prefix>-/ pattern. Uses the
//                             M1f validator's class-extraction logic
//                             but runs against HTML, not CSS.
//   html_basics        Subset of §5 of the SCOPE v3 validation rules:
//                             exactly one h1; no empty or "#" hrefs;
//                             every img has a non-empty alt.
//   slug_kebab         Slug brief is a-z0-9 lowercase with single
//                             hyphens, no leading/trailing hyphen.
//   meta_description   meta[name=description] content length is
//                             50–160 chars.
//
// Added in M11-4:
//
//   html_size          Runs first so pathological mis-generations
//                             short-circuit before the regex-heavy
//                             gates scan a 1MB string. 500KB cap
//                             matches the render-side cap in
//                             components/PageHtmlPreview.tsx (both
//                             import HTML_SIZE_MAX_BYTES from
//                             lib/html-size so the numbers can never
//                             drift).
//
// Gates deferred to a follow-up slice (M3-5b), with reasons:
//
//   allowed_components HC-1 — requires parsing the HTML against the
//                             active design system's component
//                             registry, which means wiring that
//                             registry into the worker path. Doable
//                             but widens scope; the scope_prefix
//                             gate catches the ambient "Claude
//                             invented classes" failure mode today.
//   no_freeform_html   HC-3 — same registry dependency.
//   word_count         requires per-template min/max, which isn't a
//                             column on design_templates yet.
//
// Slug uniqueness is NOT a runtime gate here — M3-6 enforces it via
// the pages UNIQUE (site_id, slug) pre-commit INSERT. Doing it in
// two places would create a race window; doing it only in gates
// would skip WP-side duplicate detection. One place wins: M3-6.
// ---------------------------------------------------------------------------

export type GateSkip = { kind: "skipped"; gate: GateName; reason: string };
export type GatePass = { kind: "pass"; gate: GateName };
export type GateFail = {
  kind: "fail";
  gate: GateName;
  reason: string;
  details?: Record<string, unknown>;
};
export type GateResult = GatePass | GateFail | GateSkip;

export type GateName =
  | "html_size"
  | "wrapper"
  | "scope_prefix"
  | "html_basics"
  | "slug_kebab"
  | "meta_description";

export type GateContext = {
  html: string;
  slug: string | null;
  prefix: string;
  design_system_version: string;
};

type GateFn = (ctx: GateContext) => GateResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KEBAB_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Extract every class token from every class="..." attribute in the
// HTML. Tolerant of single quotes and extra whitespace. This is a
// lightweight HTML scan — sufficient for well-formed Claude output,
// explicitly not bulletproof against hostile input.
function extractClassTokens(html: string): string[] {
  const out: string[] = [];
  const re = /class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (!raw) continue;
    for (const token of raw.split(/\s+/)) {
      if (token) out.push(token);
    }
  }
  return out;
}

function countTagOccurrences(html: string, tag: string): number {
  const re = new RegExp(`<${tag}[\\s>]`, "gi");
  const m = html.match(re);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// Gate implementations
// ---------------------------------------------------------------------------

/**
 * M11-4: reject generations whose HTML exceeds HTML_SIZE_MAX_BYTES
 * (500KB). Runs first so oversized payloads short-circuit before the
 * regex-heavy gates scan them.
 */
export const gateHtmlSize: GateFn = (ctx) => {
  const res = checkHtmlSize(ctx.html);
  if (res.ok) return { kind: "pass", gate: "html_size" };
  return {
    kind: "fail",
    gate: "html_size",
    reason: `Generated HTML is ${res.actual_bytes} bytes, over the ${res.cap_bytes}-byte cap.`,
    details: {
      code: "HTML_TOO_LARGE",
      actual_bytes: res.actual_bytes,
      cap_bytes: res.cap_bytes,
    },
  };
};

/** HC-2: outermost element has data-ds-version matching the site's active DS. */
export const gateWrapper: GateFn = (ctx) => {
  // Find the FIRST opening tag with attributes and inspect for
  // data-ds-version. Accept either single- or double-quoted values.
  const first = /<([a-z][a-z0-9]*)\b([^>]*)>/i.exec(ctx.html);
  if (!first) {
    return {
      kind: "fail",
      gate: "wrapper",
      reason: "No opening tag found in generated HTML.",
    };
  }
  const attrs = first[2] ?? "";
  const dsAttr = /\bdata-ds-version\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  if (!dsAttr) {
    return {
      kind: "fail",
      gate: "wrapper",
      reason: "Outermost element is missing data-ds-version attribute (HC-2).",
    };
  }
  const value = (dsAttr[1] ?? dsAttr[2] ?? "").trim();
  if (!value) {
    return {
      kind: "fail",
      gate: "wrapper",
      reason: "data-ds-version attribute is empty.",
    };
  }
  if (value !== ctx.design_system_version) {
    return {
      kind: "fail",
      gate: "wrapper",
      reason: `data-ds-version="${value}" does not match the site's active design system version (${ctx.design_system_version}).`,
      details: {
        expected: ctx.design_system_version,
        actual: value,
      },
    };
  }
  return { kind: "pass", gate: "wrapper" };
};

/** HC-4: every class token is prefixed with the site's scope prefix. */
export const gateScopePrefix: GateFn = (ctx) => {
  const prefixRe = new RegExp(`^${ctx.prefix}(?:-[a-z0-9]+)+$`);
  const classes = extractClassTokens(ctx.html);
  const violations = classes.filter((c) => !prefixRe.test(c));
  if (violations.length === 0) {
    return { kind: "pass", gate: "scope_prefix" };
  }
  return {
    kind: "fail",
    gate: "scope_prefix",
    reason: `Found ${violations.length} class(es) outside the '${ctx.prefix}-' prefix. First: '${violations[0]}'.`,
    details: { prefix: ctx.prefix, violations: violations.slice(0, 10) },
  };
};

/** Subset of the SCOPE v3 validation rules we can check with string scans. */
export const gateHtmlBasics: GateFn = (ctx) => {
  const h1Count = countTagOccurrences(ctx.html, "h1");
  if (h1Count !== 1) {
    return {
      kind: "fail",
      gate: "html_basics",
      reason: `Expected exactly one <h1>, found ${h1Count}.`,
      details: { h1_count: h1Count },
    };
  }

  // Placeholder / empty hrefs. <a href="#"> and <a href=""> are
  // generation-time failures per SCOPE v3.
  const badHref = /<a\b[^>]*\bhref\s*=\s*(?:""|'')|<a\b[^>]*\bhref\s*=\s*["']#["']/i;
  if (badHref.test(ctx.html)) {
    return {
      kind: "fail",
      gate: "html_basics",
      reason: 'Found placeholder or empty href ("" or "#"). Every link must resolve.',
    };
  }

  // Every <img> carries a non-empty alt. Regex that finds an <img>
  // tag missing an alt attribute or with alt="".
  const imgRe = /<img\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(ctx.html)) !== null) {
    const attrs = match[1] ?? "";
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    if (!alt) {
      return {
        kind: "fail",
        gate: "html_basics",
        reason: "Found <img> tag without an alt attribute.",
      };
    }
    const value = (alt[1] ?? alt[2] ?? "").trim();
    if (!value) {
      return {
        kind: "fail",
        gate: "html_basics",
        reason: "Found <img> tag with empty alt text.",
      };
    }
  }

  return { kind: "pass", gate: "html_basics" };
};

/** Slug kebab-case format. Uniqueness is enforced at WP publish. */
export const gateSlugKebab: GateFn = (ctx) => {
  if (!ctx.slug) {
    return {
      kind: "fail",
      gate: "slug_kebab",
      reason: "No slug present in slot inputs.",
    };
  }
  if (!KEBAB_SLUG.test(ctx.slug)) {
    return {
      kind: "fail",
      gate: "slug_kebab",
      reason: `Slug '${ctx.slug}' is not lowercase kebab-case (expected a-z, 0-9, single hyphens, no leading/trailing hyphen).`,
    };
  }
  return { kind: "pass", gate: "slug_kebab" };
};

/** meta[name=description] content length between 50 and 160 chars. */
export const gateMetaDescription: GateFn = (ctx) => {
  const re = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
  const m = re.exec(ctx.html);
  if (!m) {
    // Allow the attribute order to be reversed.
    const reReverse = /<meta\b[^>]*\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*\bname\s*=\s*["']description["']/i;
    const m2 = reReverse.exec(ctx.html);
    if (!m2) {
      return {
        kind: "fail",
        gate: "meta_description",
        reason: "No <meta name=\"description\"> tag found.",
      };
    }
    const content = (m2[1] ?? m2[2] ?? "").trim();
    return validateMetaLen(content);
  }
  const content = (m[1] ?? m[2] ?? "").trim();
  return validateMetaLen(content);
};

function validateMetaLen(content: string): GateResult {
  if (content.length < 50 || content.length > 160) {
    return {
      kind: "fail",
      gate: "meta_description",
      reason: `Meta description length ${content.length} is outside 50–160 range.`,
      details: { length: content.length },
    };
  }
  return { kind: "pass", gate: "meta_description" };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

// Path B (PB-1, 2026-04-29): gateMetaDescription dropped from ALL_GATES.
// Runner now emits content fragments without a <head>, so meta tags
// can never appear in the HTML. Population for posts will flow through
// the WP REST `excerpt` field (BACKLOG: "Post meta description via WP
// excerpt (path B)"). Pages don't need a meta description in WP at
// all — the theme + SEO plugin handle it. The gate function stays
// exported for any future caller that needs it, but the production
// runner never invokes it.
export const ALL_GATES: Array<{ name: GateName; fn: GateFn }> = [
  { name: "html_size", fn: gateHtmlSize },
  { name: "wrapper", fn: gateWrapper },
  { name: "scope_prefix", fn: gateScopePrefix },
  { name: "html_basics", fn: gateHtmlBasics },
  { name: "slug_kebab", fn: gateSlugKebab },
];

// Re-export HTML_SIZE_MAX_BYTES so callers who import only the gates
// can read the cap constant without pulling a second module.
export { HTML_SIZE_MAX_BYTES };

export type RunGatesResult =
  | { kind: "passed"; gates_run: GateName[] }
  | {
      kind: "failed";
      gates_run: GateName[];
      first_failure: GateFail;
    };

/**
 * Run gates in declared order, short-circuiting on the first failure.
 * The caller uses `first_failure` to mark the slot failed and record
 * the specific gate in the event log.
 */
export function runGates(ctx: GateContext): RunGatesResult {
  const run: GateName[] = [];
  for (const { name, fn } of ALL_GATES) {
    const res = fn(ctx);
    run.push(name);
    if (res.kind === "fail") {
      return { kind: "failed", gates_run: run, first_failure: res };
    }
  }
  return { kind: "passed", gates_run: run };
}
