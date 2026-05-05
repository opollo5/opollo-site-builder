// ---------------------------------------------------------------------------
// Layer 2 scope-prefix validator (§3.6 of the M1 brief).
//
// Every component's CSS must use class selectors prefixed with the client's
// scope — e.g. `ls-` for LeadSource. This validator runs at admin-UI input
// time (component POST/PATCH routes) and rejects inserts that contain any
// unprefixed class selector, listing the offending selectors with line
// numbers so operators can fix them.
//
// Layer 1 (stylelint build-time) and Layer 3 (generator-runtime class
// registry check) are M1f. This file is intentionally small and
// dependency-free — a targeted regex pass is good enough for the M1e-1
// validator role.
// ---------------------------------------------------------------------------

export type ScopePrefixViolation = {
  selector: string;
  line: number;
};

export type ScopePrefixValidation =
  | { valid: true }
  | { valid: false; violations: ScopePrefixViolation[] };

// A class selector is a literal `.` followed by an identifier:
//   first char: letter or underscore (we don't support CSS escapes here)
//   rest:       letters, digits, underscore, hyphen
const CLASS_SELECTOR_RE = /\.([a-zA-Z_][a-zA-Z0-9_-]*)/g;

// CSS block comments /* ... */ and url(...) values can contain the literal
// `.classname` shape inside them (e.g. inside data: URLs). Stripping both
// before regex-matching avoids false positives without needing a real CSS
// parser.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const URL_VALUE_RE = /url\([^)]*\)/g;

/**
 * Checks that every class selector in `css` starts with `${prefix}-`.
 *
 * The check is literal and regex-based — it will not catch advanced CSS
 * like `@supports` blocks with nested selectors, escape sequences in class
 * names, or class-like fragments inside non-URL strings. Those aren't in the
 * M1 usage scope; if they show up, tighten the validator then.
 *
 * Prefix must match the sites.prefix CHECK constraint: 2–4 lowercase
 * alphanumerics. That's enforced at the sites layer; this function accepts
 * any non-empty prefix and trusts the caller.
 */
export function validateScopedCss(
  css: string,
  prefix: string,
): ScopePrefixValidation {
  if (!prefix) {
    throw new Error("validateScopedCss: prefix is required.");
  }

  const required = `${prefix}-`;
  const stripped = stripIgnorable(css);
  const violations: ScopePrefixViolation[] = [];

  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    CLASS_SELECTOR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CLASS_SELECTOR_RE.exec(line)) !== null) {
      const className = match[1];
      if (!className.startsWith(required)) {
        violations.push({ selector: `.${className}`, line: i + 1 });
      }
    }
  }

  return violations.length === 0
    ? { valid: true }
    : { valid: false, violations };
}

// Replaces block comments and url(...) values with equal-length blank runs
// so line numbers stay accurate for the violation reporter.
function stripIgnorable(css: string): string {
  const blanked = css.replace(BLOCK_COMMENT_RE, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  return blanked.replace(URL_VALUE_RE, (m) => m.replace(/[^\n]/g, " "));
}

// ---------------------------------------------------------------------------
// extractCssClasses — Layer-3 helper (M1f).
//
// Returns the full set of class names DEFINED by the CSS, regardless of
// prefix. Compound selectors (`.a.b`), descendant chains (`.a > .b`), and
// negations (`:not(.x)`) all contribute every class they mention.
//
// The parsing strategy is intentionally regex-based to stay dep-free: same
// strip-ignorable pass as validateScopedCss() runs, then CLASS_SELECTOR_RE
// picks up every `.ident` occurrence in selector context.
// ---------------------------------------------------------------------------

export function extractCssClasses(css: string): Set<string> {
  const out = new Set<string>();
  const stripped = stripIgnorable(css);
  CLASS_SELECTOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CLASS_SELECTOR_RE.exec(stripped)) !== null) {
    out.add(match[1]);
  }
  return out;
}
