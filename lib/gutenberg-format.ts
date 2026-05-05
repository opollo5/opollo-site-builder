import "server-only";

// ---------------------------------------------------------------------------
// lib/gutenberg-format.ts
//
// M16-8 — Convert Opollo-rendered HTML into WordPress Gutenberg block
// content format.
//
// Opollo renders each section as:
//   <div class="opollo-{Type} opollo-{Type}--{variant}" data-opollo-id="{uuid}">
//     ... inner HTML ...
//   </div>
//
// For WP publish we wrap the full page HTML in a single Custom HTML block so
// WordPress stores and round-trips it without any Gutenberg parsing.  The
// `data-opollo-id` attributes on individual sections survive the round-trip
// and are what the drift detector checks.
//
// The outer `data-opollo-page-id` attribute lets the drift detector locate
// an Opollo-managed page on WP without relying on the slug.
// ---------------------------------------------------------------------------

/**
 * Returns true when `html` was produced by the M16 renderer.
 * Heuristic: M16 pages always include at least one `data-opollo-id` attr.
 */
export function isGutenbergCandidate(html: string): boolean {
  return html.includes("data-opollo-id");
}

/**
 * Wraps rendered HTML in a single WordPress Custom HTML (<!-- wp:html -->)
 * block with an outer `data-opollo-page-id` attribution div.
 *
 * Non-M16 HTML passes through unchanged — `isGutenbergCandidate` should
 * be checked before calling.
 */
export function wrapInGutenbergBlock(html: string, pageId: string): string {
  const safePageId = pageId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `<!-- wp:html -->\n<div data-opollo-page-id="${safePageId}">\n${html}\n</div>\n<!-- /wp:html -->`;
}

/**
 * Produces a Gutenberg Custom HTML block for a named, synced pattern
 * (wp_block post type).  CTA content and other shared_content items are
 * pushed as reusable blocks so the same Gutenberg block can appear in
 * multiple pages with one canonical definition.
 */
export function sharedContentToBlock(
  label: string,
  contentType: string,
  content: Record<string, unknown>,
): string {
  // Encode the shared content as an HTML comment + JSON blob inside a
  // Custom HTML block.  WP stores it verbatim; Opollo reads it back on
  // drift checks.  A future rich-renderer can replace this with proper
  // Gutenberg block markup for each content type.
  const safeLabel = label.replace(/[<>&"]/g, "").slice(0, 200);
  return [
    `<!-- wp:html -->`,
    `<!-- opollo-content-type: ${contentType} -->`,
    `<!-- opollo-label: ${safeLabel} -->`,
    `<div class="opollo-shared-content opollo-shared-content--${contentType}" data-opollo-content-type="${contentType}">`,
    `<script type="application/json" class="opollo-content-data">${JSON.stringify(content)}</script>`,
    `</div>`,
    `<!-- /wp:html -->`,
  ].join("\n");
}

/**
 * Computes the content hash string that is stored in
 * `route_registry.wp_content_hash` after a successful publish.
 * Uses the Web Crypto API (Node 18+ built-in).
 */
export async function computeContentHash(html: string): Promise<string> {
  const buf = new TextEncoder().encode(html);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
