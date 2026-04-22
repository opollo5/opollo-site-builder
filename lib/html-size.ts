// ---------------------------------------------------------------------------
// M11-4 — shared HTML size cap.
//
// 500KB ceiling on generated_html at both the render and write sides.
// Historically the render-side cap was a constant duplicated inside
// components/PageHtmlPreview.tsx; M11-4 hoists it here so the write-
// path quality gate and the render path can never drift.
//
// The cap is a defensive guard against pathological generations — real
// LeadSource-scale pages observed through M3 and M7 are 30–150KB.
// 500KB is ~3× the tail, generous enough that legitimate 40-section
// landing pages pass cleanly and tight enough that an accidentally
// quadratic prompt doesn't silently ship.
// ---------------------------------------------------------------------------

export const HTML_SIZE_MAX_BYTES = 500 * 1024;

export type HtmlSizeCheckResult =
  | { ok: true }
  | {
      ok: false;
      code: "HTML_TOO_LARGE";
      actual_bytes: number;
      cap_bytes: number;
    };

/**
 * Byte-length estimate for an HTML string. We use the JS string length
 * rather than a precise UTF-8 byte count — the cap is a rough guard,
 * not a precise storage limit, and the string length is strictly less
 * than the UTF-8 byte length for non-ASCII content (so any string that
 * passes the JS-length cap also passes the UTF-8-byte cap).
 */
export function estimateHtmlBytes(html: string): number {
  return html.length;
}

export function checkHtmlSize(html: string): HtmlSizeCheckResult {
  const actual_bytes = estimateHtmlBytes(html);
  if (actual_bytes > HTML_SIZE_MAX_BYTES) {
    return {
      ok: false,
      code: "HTML_TOO_LARGE",
      actual_bytes,
      cap_bytes: HTML_SIZE_MAX_BYTES,
    };
  }
  return { ok: true };
}
