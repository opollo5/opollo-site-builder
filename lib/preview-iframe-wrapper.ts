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

export interface PreviewWrapOptions {
  /**
   * For copy_existing sites, pointing the iframe at the source WP origin
   * lets us pull the live theme stylesheet via <link rel="stylesheet">.
   * The browser will only honour same-origin relative URLs in the
   * iframe srcdoc, so we inject a <base href> and a small list of
   * known stylesheet entry points (style.css + Elementor common bundles).
   * Cross-origin CSS is permitted by the browser; CSP comes from our
   * site, not the iframe srcdoc, so it doesn't apply to the iframe doc.
   *
   * The supplied URL should be the site's wp_url (or any URL on the
   * same origin as the published page). Paths typically don't matter —
   * we only use the origin.
   */
  themeOriginUrl?: string | null;
  /**
   * Direct stylesheet URLs to inject as <link rel="stylesheet"> tags.
   * Used by the extraction pass to forward known stylesheet hrefs the
   * site advertises (Elementor's frontend.css + theme style.css).
   */
  themeStylesheetUrls?: string[] | null;
}

/**
 * Returns the html string ready to feed into an iframe srcdoc.
 *
 * - For path-A documents (have <!DOCTYPE> or <html opener): returns
 *   the input unchanged. Legacy / evidence pages render as before.
 * - For path-B fragments: wraps in a synthetic doc with the shim
 *   stylesheet. The fragment becomes the iframe body's content.
 * - When `themeOriginUrl` or `themeStylesheetUrls` is supplied (per
 *   the copy_existing extraction), an additional <base href> + theme
 *   stylesheets are injected so Elementor / Kadence classes light up
 *   in the preview iframe instead of rendering as unstyled text.
 *
 * Empty / nullish input returns an empty string so the caller can
 * branch on truthiness.
 */
export function wrapForPreview(
  html: string | null | undefined,
  options: PreviewWrapOptions = {},
): string {
  if (!html) return "";
  const trimmed = html.trim();
  if (trimmed.length === 0) return "";

  const claimsCompleteness =
    /<!DOCTYPE\s+html\b/i.test(trimmed) || /<html[\s>]/i.test(trimmed);
  if (claimsCompleteness) {
    // Path-A: render unchanged. Document carries its own chrome and CSS.
    return html;
  }

  // Build a list of <link rel="stylesheet"> tags for the iframe head.
  // 1. Operator-supplied themeStylesheetUrls (preferred — populated by
  //    the copy_existing extraction)
  // 2. Otherwise: when themeOriginUrl is set, attempt the canonical
  //    Elementor + theme bundles. These 404 silently if the site
  //    doesn't have them; cost is one wasted request per slot.
  const stylesheetTags: string[] = [];
  const seen = new Set<string>();
  function pushLink(href: string) {
    if (!href) return;
    if (seen.has(href)) return;
    seen.add(href);
    stylesheetTags.push(
      `<link rel="stylesheet" href="${href.replace(/"/g, "&quot;")}">`,
    );
  }
  for (const href of options.themeStylesheetUrls ?? []) {
    pushLink(href);
  }
  if (options.themeOriginUrl) {
    try {
      const u = new URL(options.themeOriginUrl);
      const origin = u.origin;
      pushLink(`${origin}/wp-content/plugins/elementor/assets/css/frontend.min.css`);
      pushLink(
        `${origin}/wp-content/plugins/elementor-pro/assets/css/frontend.min.css`,
      );
      // theme style.css fallback — tries the parent theme. WordPress
      // serves the stub stylesheet at /wp-content/themes/<theme>/style.css
      // but we don't know the theme slug; the catch-all rest endpoint
      // hint isn't exposed on every site. Skip for now — Elementor's
      // bundle covers most of the visual chrome.
    } catch {
      // invalid URL → skip
    }
  }

  // Path-B: synthetic wrapper around the fragment.
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    options.themeOriginUrl
      ? `<base href="${new URL(options.themeOriginUrl).origin}/">`
      : "",
    ...stylesheetTags,
    "<style>",
    SHIM_STYLESHEET,
    "</style>",
    "</head>",
    "<body>",
    html,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");
}
