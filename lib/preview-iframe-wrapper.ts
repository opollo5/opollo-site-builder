// ---------------------------------------------------------------------------
// PB-3 (2026-04-29) — Preview iframe wrapper.
//
// The runner emits path-B body fragments (PB-1, PR #194). The preview
// iframe in BriefRunClient (and any future preview surface) used to
// render the fragment directly via `srcDoc={html}`, which produced an
// unstyled raw rendering — useless for visual review because the host
// WP theme's CSS isn't applied.
//
// This helper wraps the fragment in a synthetic HTML document with a
// shimmed default stylesheet that approximates WP/Kadence Blocks
// defaults: sensible body font, basic typography, and CSS variables
// scoped to [data-opollo] that the design system can read. The shim
// is NOT pixel-perfect to the customer's actual published page, but
// it lets the operator visually review content + structure + image
// placement against a reasonable baseline.
//
// Higher fidelity (fetching the customer's actual theme CSS bundle
// and inlining it) is a follow-up — see BACKLOG entry "Preview
// iframe — fetch customer theme CSS for high-fidelity preview".
//
// Path-A passthrough: documents that claim completeness (have
// <!DOCTYPE> or an <html opener) are returned unchanged. Path-A is
// retained for backwards compatibility with legacy generations and
// for the dcbdf7d5-... evidence page.
//
// Pure logic — no DOM, no network. Safe in any runtime.
// ---------------------------------------------------------------------------

const SHIM_STYLESHEET = `
  /* Path-B preview shim. Approximates WP/Kadence Blocks defaults
     so a fragment renders styled-enough for visual review. NOT
     pixel-accurate to the customer's published page. */
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
    font-size: 16px;
    line-height: 1.6;
    color: #1f2937;
    background: #ffffff;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  [data-opollo] {
    /* Container width approximates the typical WP theme content area. */
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    /* Design-system token defaults — actual values come from the
       theme + M13 sync in production. These are sensible fallbacks. */
    --ds-color-primary: #2563eb;
    --ds-color-text: #1f2937;
    --ds-color-muted: #6b7280;
    --ds-color-bg: #ffffff;
    --ds-color-bg-alt: #f9fafb;
    --ds-radius: 0.5rem;
    --ds-spacing: 1rem;
  }
  [data-opollo] + [data-opollo] {
    border-top: 1px solid #e5e7eb;
  }
  [data-opollo] h1 {
    font-size: 2.25rem;
    font-weight: 700;
    margin: 0 0 1rem;
    line-height: 1.2;
  }
  [data-opollo] h2 {
    font-size: 1.75rem;
    font-weight: 600;
    margin: 1.5rem 0 0.75rem;
    line-height: 1.3;
  }
  [data-opollo] h3 {
    font-size: 1.375rem;
    font-weight: 600;
    margin: 1.25rem 0 0.5rem;
    line-height: 1.4;
  }
  [data-opollo] p { margin: 0 0 1rem; }
  [data-opollo] a {
    color: var(--ds-color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  [data-opollo] a:hover { text-decoration: none; }
  [data-opollo] img {
    max-width: 100%;
    height: auto;
    border-radius: var(--ds-radius);
  }
  [data-opollo] ul, [data-opollo] ol {
    margin: 0 0 1rem;
    padding-left: 1.5rem;
  }
`;

/**
 * Returns the html string ready to feed into an iframe srcdoc.
 *
 * - For path-A documents (have <!DOCTYPE> or <html opener): returns
 *   the input unchanged. Legacy / evidence pages render as before.
 * - For path-B fragments: wraps in a synthetic doc with the shim
 *   stylesheet. The fragment becomes the iframe body's content.
 *
 * Empty / nullish input returns an empty string so the caller can
 * branch on truthiness.
 */
export function wrapForPreview(html: string | null | undefined): string {
  if (!html) return "";
  const trimmed = html.trim();
  if (trimmed.length === 0) return "";

  const claimsCompleteness =
    /<!DOCTYPE\s+html\b/i.test(trimmed) || /<html[\s>]/i.test(trimmed);
  if (claimsCompleteness) {
    // Path-A: render unchanged. Document carries its own chrome and CSS.
    return html;
  }

  // Path-B: synthetic wrapper around the fragment.
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    "<style>",
    SHIM_STYLESHEET,
    "</style>",
    "</head>",
    "<body>",
    html,
    "</body>",
    "</html>",
  ].join("\n");
}
