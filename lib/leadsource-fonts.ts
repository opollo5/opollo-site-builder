// ---------------------------------------------------------------------------
// LeadSource font-load HTML. Prepended to every published page's HTML so
// the three spec fonts actually load in the browser.
//
// Why this file exists:
//   seed/leadsource/tokens.css declares font families for --ls-font-sans
//   (Inter), --ls-font-display (Inter Tight), --ls-font-mono (JetBrains
//   Mono). The CSS declaration alone does not load the fonts — the
//   browser needs an @font-face rule or a stylesheet link. The locked
//   spec (seed/leadsource/source/v2-stripe.html:7-9) uses Google Fonts
//   <link> tags to load exactly these three families at exactly these
//   weights. Without this prefix every generated page ships with system
//   fallback fonts instead of the signature LeadSource type stack.
//
// Why a string constant, not a React component or CSS import:
//   The publisher (lib/batch-publisher.ts, lib/regeneration-publisher.ts)
//   pipes generated_html verbatim into the WP REST API. There is no
//   wrapping document; the HTML is content-area markup. A plain string
//   prefix is the simplest injection point that matches the spec's
//   exact <link> elements and survives the WP content pipeline.
//
// Why it matches the spec verbatim:
//   v2-stripe.html is the locked design. Copying its Google Fonts URL
//   byte-for-byte keeps the weights, variants, and display strategy
//   aligned; any drift here produces a subtle brand-drift that would
//   only be caught by manual side-by-side. Future spec changes must
//   update both files together.
//
// Cost:
//   ~400 bytes per page. At 10k pages that is ~4 MB of repeated
//   <link> markup across the deployed fleet; acceptable for MVP.
//   A follow-on optimisation is to hoist the font load into the
//   WP theme so the per-page prefix can be dropped.
// ---------------------------------------------------------------------------

export const LEADSOURCE_FONT_LOAD_HTML =
  '<link rel="preconnect" href="https://fonts.googleapis.com">' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">';
