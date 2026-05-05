// ---------------------------------------------------------------------------
// Hallucinated-image-URL guard.
//
// UAT (2026-05-02) — operators reported broken images in generated
// previews. Anthropic occasionally synthesises plausible-looking
// stock-image URLs (unsplash.com/photos/<random>, picsum.photos/<n>,
// example.com/team-1.jpg, /images/hero.jpg, etc.) that 404 in the
// preview iframe and on the published WP page.
//
// Without per-image search grounding (which the brief-runner doesn't
// have today — image-library context is opt-in via
// sites.use_image_library), the safest move is to strip any <img> tag
// whose src isn't from a host we control or trust:
//   - imagedelivery.net (Cloudflare Images — what we publish to)
//   - data: URIs (inline / placeholder pixels)
//   - the explicit allowlist supplied by the caller (e.g. the source
//     WP origin for copy_existing sites)
//
// Stripped tags are replaced with a tiny gray-block data URI so the
// surrounding layout doesn't collapse, and an alt text is appended
// noting the removal so reviewers see why the image is missing.
//
// Pure logic — no DOM, no network. Safe in any runtime.
// ---------------------------------------------------------------------------

const ALWAYS_ALLOWED_HOST_PATTERNS: RegExp[] = [
  // Cloudflare Images — our own published delivery domain.
  /^imagedelivery\.net$/i,
  // Cloudflare imagedelivery accounts use subdomain hashes too.
  /\.imagedelivery\.net$/i,
];

// 1×1 transparent PNG. Keeps layout stable while flagging missing images.
const PLACEHOLDER_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const PLACEHOLDER_ALT_SUFFIX = " (image removed — generator produced an unverifiable URL)";

export interface StripImagesOptions {
  /**
   * Hosts to permit beyond the always-allowed set. Pass the source-site
   * origin for copy_existing flows (operators can legitimately reference
   * existing media library URLs on the customer's WP).
   */
  allowedOrigins?: string[];
}

/**
 * Returns the html with hallucinated image tags neutralised.
 *
 * Permits:
 *   - data: URIs (placeholders, inline previews)
 *   - imagedelivery.net (Cloudflare Images — what we publish to)
 *   - any explicit `allowedOrigins` (e.g. the WP source for copy_existing)
 *
 * Strips everything else by:
 *   - replacing the src with a 1×1 placeholder data URI
 *   - appending a marker to the alt attribute (or adding alt="" if absent)
 *
 * Pure regex pass — handles malformed HTML gracefully (no DOMParser).
 */
export function stripHallucinatedImages(
  html: string,
  options: StripImagesOptions = {},
): { html: string; strippedCount: number } {
  if (!html) return { html: "", strippedCount: 0 };

  const allowedOriginHosts = new Set<string>();
  for (const origin of options.allowedOrigins ?? []) {
    try {
      const u = new URL(origin);
      allowedOriginHosts.add(u.host.toLowerCase());
    } catch {
      // skip malformed origin
    }
  }

  let strippedCount = 0;
  // Match <img ... src="..." ...> — both attribute order variants.
  // Attribute regex is greedy enough to cover the full tag.
  const next = html.replace(
    /<img\b([^>]*)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>/gi,
    (full, before: string, dq: string | undefined, sq: string | undefined, bare: string | undefined, after: string) => {
      const src = (dq ?? sq ?? bare ?? "").trim();
      if (!src) {
        // No src at all — drop the tag entirely (it would 404 anyway).
        strippedCount += 1;
        return "";
      }
      if (src.startsWith("data:")) return full;

      // Try to parse as a full URL. Relative URLs (start with / or just
      // path segments) can't be verified at generation time; treat
      // them as "unverifiable" and strip too — we don't ship relative
      // image refs.
      let host: string | null = null;
      try {
        const parsed = new URL(src);
        host = parsed.host.toLowerCase();
      } catch {
        // Relative or malformed URL → strip.
        host = null;
      }

      if (host !== null) {
        if (allowedOriginHosts.has(host)) return full;
        if (ALWAYS_ALLOWED_HOST_PATTERNS.some((re) => re.test(host!))) {
          return full;
        }
      }

      // Not allowed → replace src with placeholder + annotate alt.
      strippedCount += 1;
      const replacedSrcAttrs = `${before}src="${PLACEHOLDER_DATA_URI}"${after}`;
      // Append placeholder marker to alt; preserve existing alt content.
      const altRe = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
      const altMatch = altRe.exec(replacedSrcAttrs);
      if (altMatch) {
        const existingAlt =
          altMatch[1] ?? altMatch[2] ?? altMatch[3] ?? "";
        if (existingAlt.endsWith(PLACEHOLDER_ALT_SUFFIX)) {
          return `<img${replacedSrcAttrs}>`;
        }
        const newAlt = `${existingAlt}${PLACEHOLDER_ALT_SUFFIX}`.trim();
        const updated = replacedSrcAttrs.replace(
          altRe,
          `alt="${newAlt.replace(/"/g, "&quot;")}"`,
        );
        return `<img${updated}>`;
      }
      return `<img${replacedSrcAttrs} alt="${PLACEHOLDER_ALT_SUFFIX
        .trim()
        .replace(/"/g, "&quot;")}">`;
    },
  );

  return { html: next, strippedCount };
}
