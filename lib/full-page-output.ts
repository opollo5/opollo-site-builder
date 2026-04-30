import "server-only";

import {
  renderTrafficSplitSnippet,
  type TrafficSplitConfig,
} from "@/lib/optimiser/ab-testing/traffic-split-snippet";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 14 — Full-page HTML composition.
//
// Wraps the brief-runner's existing fragment output (a series of
// <section data-opollo>…</section> blocks) in a complete standalone
// HTML document including <head> with meta tags + tracking pixels +
// inlined CSS, and <body> wrapped with the client's site_conventions
// chrome (header / footer / nav).
//
// Pure logic — no DB, no network, no fs. Caller assembles the inputs
// from site_conventions + opt_clients.tracking_config and passes them
// in. Tested in lib/__tests__/full-page-output.test.ts.
//
// Design decisions:
//   - CSS is INLINED into <style> in the head. Existing component CSS
//     is already embedded per-fragment by the slice-mode pipeline; for
//     full_page we deduplicate component CSS into one <style> block
//     so the document is self-contained. External CSS would require
//     the static hosting target to also serve /opt-assets/<slug>/
//     which adds a separate write step + cache invalidation surface
//     not worth it for v1.
//   - JS bundling deferred — the existing components don't ship
//     interactive JS today. When they do, mirror the CSS pattern.
//   - Tracking pixels: GA4 (gtag.js) + Google Ads (gtag conversion).
//     Both render only when tracking_config has the matching keys.
//   - HTML escaping: the page title + description are escaped; the
//     body / chrome / inlined CSS / pixel script payload are NOT
//     escaped (they're trusted server-generated HTML).
// ---------------------------------------------------------------------------

export interface FullPageChrome {
  header_html: string;
  footer_html: string;
  nav_html: string;
  source_url: string;
  extracted_at: string;
}

export interface TrackingConfig {
  ga4_measurement_id?: string;
  google_ads_conversion_id?: string;
  google_ads_conversion_label?: string;
}

export interface FullPageMeta {
  /** Document <title>. Required. */
  title: string;
  /** <meta name="description">. Optional but strongly recommended. */
  description?: string;
  /** Canonical URL for <link rel="canonical">. */
  canonical_url?: string;
  /** Open Graph image URL for social previews. */
  og_image_url?: string;
  /** Lang attribute on <html>. Defaults to "en". */
  lang?: string;
}

export interface ComposeFullPageInput {
  /** Brief-runner's fragment output — a string of <section data-opollo> blocks. */
  fragmentHtml: string;
  /** Per-component CSS, deduplicated and concatenated. */
  cssBundle: string;
  /** Header / footer / nav HTML extracted from the client's homepage. */
  chrome: FullPageChrome;
  /** Per-client tracking pixel config from opt_clients.tracking_config. */
  tracking: TrackingConfig;
  /** Document metadata. */
  meta: FullPageMeta;
  /** When this page is part of a running A/B test, the JS hash split
   *  config that routes a percentage of visitors to variant B. Emitted
   *  as the first <script> in <head> so it runs before content render
   *  (avoids a flash of the wrong variant). Omit when no test is
   *  active — the page renders without any split logic. */
  abSplit?: TrafficSplitConfig;
}

export function composeFullPage(input: ComposeFullPageInput): string {
  const lang = input.meta.lang ?? "en";
  const head = renderHead(
    input.meta,
    input.cssBundle,
    input.tracking,
    input.abSplit,
  );
  const body = renderBody(
    input.fragmentHtml,
    input.chrome,
    input.tracking,
  );
  return `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
${head}
</head>
<body>
${body}
</body>
</html>`;
}

function renderHead(
  meta: FullPageMeta,
  cssBundle: string,
  tracking: TrackingConfig,
  abSplit: TrafficSplitConfig | undefined,
): string {
  const lines: string[] = [
    // charset MUST be in the first 1024 bytes of <head> per HTML5.
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
  ];
  // Traffic-split snippet runs before any pixel / content (after the
  // mandatory meta charset). If the visitor needs to be redirected
  // to the other variant, that happens before paint and before GA4
  // fires a session for the wrong variant.
  if (abSplit) {
    lines.push(renderTrafficSplitSnippet(abSplit));
  }
  lines.push(`<title>${escapeHtml(meta.title)}</title>`);
  if (meta.description) {
    lines.push(
      `<meta name="description" content="${escapeAttr(meta.description)}">`,
    );
  }
  if (meta.canonical_url) {
    lines.push(`<link rel="canonical" href="${escapeAttr(meta.canonical_url)}">`);
    lines.push(
      `<meta property="og:url" content="${escapeAttr(meta.canonical_url)}">`,
    );
  }
  lines.push(`<meta property="og:title" content="${escapeAttr(meta.title)}">`);
  if (meta.description) {
    lines.push(
      `<meta property="og:description" content="${escapeAttr(meta.description)}">`,
    );
  }
  if (meta.og_image_url) {
    lines.push(
      `<meta property="og:image" content="${escapeAttr(meta.og_image_url)}">`,
    );
  }
  if (cssBundle.trim().length > 0) {
    lines.push(`<style>\n${cssBundle}\n</style>`);
  }
  // Tracking pixels last so they don't block content render.
  const ga4 = renderGa4Snippet(tracking);
  if (ga4) lines.push(ga4);
  const gAds = renderGoogleAdsSnippet(tracking);
  if (gAds) lines.push(gAds);
  return lines.join("\n");
}

function renderBody(
  fragmentHtml: string,
  chrome: FullPageChrome,
  tracking: TrackingConfig,
): string {
  // Optional fallback noscript pixel for Google Ads conversion (the
  // gtag head snippet handles the JS-on path).
  const noscriptAds = renderGoogleAdsNoscriptPixel(tracking);
  return [
    chrome.header_html,
    chrome.nav_html,
    `<main>\n${fragmentHtml}\n</main>`,
    chrome.footer_html,
    noscriptAds,
  ]
    .filter((s) => s && s.trim().length > 0)
    .join("\n");
}

function renderGa4Snippet(tracking: TrackingConfig): string | null {
  const id = tracking.ga4_measurement_id;
  if (!id) return null;
  // gtag.js standard snippet. The id is asserted alphanumeric +
  // hyphen at composition; we still escapeAttr to be safe against
  // a misconfigured value.
  const safeId = escapeAttr(id);
  return `<!-- GA4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${safeId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${safeId}');
</script>`;
}

function renderGoogleAdsSnippet(tracking: TrackingConfig): string | null {
  const id = tracking.google_ads_conversion_id;
  const label = tracking.google_ads_conversion_label;
  if (!id) return null;
  const safeId = escapeAttr(id);
  // Conversion event fires on a custom call from the page (the
  // landing-page CTA component will dispatch). Head snippet just
  // initialises gtag for the conversion id.
  let out = `<!-- Google Ads -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${safeId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${safeId}');
</script>`;
  if (label) {
    const safeLabel = escapeAttr(label);
    out += `
<script>
  window.opolloTrackConversion = function() {
    gtag('event', 'conversion', { send_to: '${safeId}/${safeLabel}' });
  };
</script>`;
  }
  return out;
}

function renderGoogleAdsNoscriptPixel(tracking: TrackingConfig): string | null {
  const id = tracking.google_ads_conversion_id;
  const label = tracking.google_ads_conversion_label;
  if (!id || !label) return null;
  const safeId = escapeAttr(id.replace(/^AW-/, ""));
  const safeLabel = escapeAttr(label);
  return `<noscript>
<img src="https://www.googleadservices.com/pagead/conversion/${safeId}/?label=${safeLabel}&guid=ON&script=0" width="1" height="1" alt="" style="display:none">
</noscript>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
