// ---------------------------------------------------------------------------
// Minimal HTML-fragment sanitiser for AI-generated micro-UI snippets.
//
// Scope: snippets we render via dangerouslySetInnerHTML where the
// source is the LLM (model output, not operator input). The threat
// model assumes prompt injection could cause the model to emit a
// payload from `tests/helpers/xss-payloads.ts`.
//
// Out of scope: rich operator-authored HTML (we don't have any user
// surface that calls this — sandbox iframes do that work elsewhere).
//
// Design choices:
//
//   - Allow a small structural tag list (button, div, span, p, input,
//     label, ul, ol, li, h1-h6, img, em, strong, br, hr, section,
//     header, footer). Strip every other tag.
//   - Strip every `on*=...` event-handler attribute.
//   - Strip `href` / `src` whose value parses as `javascript:`,
//     `data:` or `vbscript:`.
//   - Strip `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>`,
//     `<link>`, `<meta>` outright (with their content).
//
// Why a custom function rather than DOMPurify: DOMPurify is the right
// long-term answer; it's not in the dependency list and adding it is
// a separate decision (bundle weight, maintenance). This shim covers
// the canary's needs and lives behind a single test (red-on-break
// proves the boundary). Promote to DOMPurify when a second user
// arrives or when AI-generated HTML grows past trivial micro-UI.
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "a",
  "br",
  "button",
  "div",
  "em",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "img",
  "input",
  "label",
  "li",
  "ol",
  "p",
  "section",
  "small",
  "span",
  "strong",
  "ul",
]);

const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1>/gi;
const DROP_SELF_CLOSING = /<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi;
const EVENT_HANDLER_ATTR = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_HREF_OR_SRC =
  /\s(href|src)\s*=\s*("(?:javascript|data|vbscript):[^"]*"|'(?:javascript|data|vbscript):[^']*'|(?:javascript|data|vbscript):[^\s>]+)/gi;

/**
 * Sanitise an HTML fragment for safe rendering via
 * dangerouslySetInnerHTML. Returns a string that contains only
 * structural tags + safe attributes.
 *
 * Idempotent: sanitize(sanitize(x)) === sanitize(x).
 */
// Per-regex fixed-point helper. Apply `re` to `s` repeatedly until
// the result stops changing — defeats nested patterns like
// `<scr<script>ipt>` where a single replace pass leaves residue
// that itself matches the regex. This is the form CodeQL's
// js/incomplete-multi-character-sanitization rule recognises as
// complete.
//
// Bounded iteration count guards against pathological input. 64
// is far above any plausible legitimate nesting depth and below
// any practical DoS surface.
function fixedPointReplace(s: string, re: RegExp, replacement: string): string {
  let out = s;
  let prev: string;
  let i = 0;
  do {
    prev = out;
    out = out.replace(re, replacement);
    i++;
  } while (out !== prev && i < 64);
  return out;
}

export function sanitizeHtmlFragment(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";

  let out = input;

  // 1. Drop dangerous block tags + their content (run to fixed point).
  out = fixedPointReplace(out, DROP_WITH_CONTENT, "");
  // 2. Drop dangerous self-closing variants (run to fixed point).
  out = fixedPointReplace(out, DROP_SELF_CLOSING, "");
  // 3. Drop every event-handler attribute (onclick, onerror, ontoggle, ...).
  out = fixedPointReplace(out, EVENT_HANDLER_ATTR, "");
  // 4. Drop href / src with javascript:/data:/vbscript: schemes.
  out = fixedPointReplace(out, DANGEROUS_HREF_OR_SRC, "");

  // 5. Strip any tag whose name is not allow-listed (run to fixed
  //    point — residue tag fragments after step 1-2 may form new
  //    disallowed-tag matches once the surrounding context shifts).
  let prev: string;
  let i = 0;
  do {
    prev = out;
    out = out.replace(
      /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g,
      (match, name: string) => {
        if (ALLOWED_TAGS.has(name.toLowerCase())) return match;
        return "";
      },
    );
    i++;
  } while (out !== prev && i < 64);

  return out;
}
