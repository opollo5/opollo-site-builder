import { extractCssClasses } from "./scope-prefix";

// ---------------------------------------------------------------------------
// Layer-3 scope-prefix enforcement (§3.6 of the M1 brief).
//
// Runtime check for the M3 batch generator. Every class referenced in a
// page's HTML must exist in the design system's registered classes (union
// of classes defined across tokens.css + base-styles.css + every
// component's CSS). Classes that don't appear in the registry are almost
// certainly hallucinated by the LLM; the generator calls
// validateHtmlClasses() and refuses to commit pages that come back with
// unknownClasses.
//
// Everything in this file is pure — no I/O, no DB. The caller (M3) loads
// CSS strings from the design_systems / design_components rows, builds the
// registry once per batch, and validates each generated page's HTML
// against it.
// ---------------------------------------------------------------------------

// HTML class attribute extractor.
//
// Matches:
//   class="foo bar"   (double-quoted)
//   class='foo bar'   (single-quoted)
//   class=foo         (unquoted — HTML5 allows for single tokens)
//
// Does NOT match className= — that's JSX, not HTML. If the M3 generator
// ever emits JSX-looking content, there's a bug upstream and Layer 3
// should fail loud; we rely on the unit test to assert that contract.
const HTML_CLASS_ATTR_RE =
  /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+))/gi;

export function extractHtmlClasses(html: string): Set<string> {
  const out = new Set<string>();
  HTML_CLASS_ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HTML_CLASS_ATTR_RE.exec(html)) !== null) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    // Strip Handlebars-style template holes inside the class-attribute value
    // before tokenising. `{{x}}`-style and `{var}`-style both go. This lets
    // us validate raw templates directly — any class literals sandwiching
    // the holes are kept; fragments that were composed with the hole
    // (e.g. `ls-avatar--{{tone}}` → `ls-avatar--`) are filtered out below
    // because a valid class never ends with `-`. The M3 renderer calls
    // this helper with fully-substituted HTML and never sees these cases
    // in practice.
    const stripped = raw
      .replace(/\{\{[\s\S]*?\}\}/g, " ")
      .replace(/\{[^{}]*\}/g, " ");
    for (const token of stripped.split(/\s+/)) {
      const trimmed = token.trim();
      if (trimmed.length === 0) continue;
      // Any brace left behind is a malformed fragment.
      if (/[{}]/.test(trimmed)) continue;
      // Trailing hyphen(s) = incomplete class left over from a stripped
      // template interpolation. `ls-avatar--{{tone}}` would leave
      // `ls-avatar--` after stripping — skip it; the rendered form gets
      // validated at M3 generation time.
      if (/-$/.test(trimmed)) continue;
      out.add(trimmed);
    }
  }
  return out;
}

export function buildClassRegistry(args: {
  tokensCss: string;
  baseStyles: string;
  componentCss: string[];
  allowlist?: ReadonlyArray<string>;
}): Set<string> {
  const registry = new Set<string>();
  for (const cls of extractCssClasses(args.tokensCss)) registry.add(cls);
  for (const cls of extractCssClasses(args.baseStyles)) registry.add(cls);
  for (const css of args.componentCss) {
    for (const cls of extractCssClasses(css)) registry.add(cls);
  }
  if (args.allowlist) {
    for (const cls of args.allowlist) registry.add(cls);
  }
  return registry;
}

// Stable, minimal return shape. M3 is the consumer — formatting of retry
// prompts, diff rendering, etc. all live there; this layer just reports
// facts.
export type ClassRegistryValidation =
  | { valid: true }
  | { valid: false; unknownClasses: string[] };

export function validateHtmlClasses(
  html: string,
  registry: Set<string>,
): ClassRegistryValidation {
  const htmlClasses = extractHtmlClasses(html);
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const cls of htmlClasses) {
    if (registry.has(cls)) continue;
    if (seen.has(cls)) continue;
    seen.add(cls);
    unknown.push(cls);
  }
  if (unknown.length === 0) return { valid: true };
  return { valid: false, unknownClasses: unknown };
}
