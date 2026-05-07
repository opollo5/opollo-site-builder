// ---------------------------------------------------------------------------
// Spec 09 — Alt-text derivation for WP-published images.
//
// Strips a trailing " - {siteName}" / " | {siteName}" / " – {siteName}" /
// " — {siteName}" suffix from a SEO title, falling back to the post title
// when SEO title is empty. Whitespace-tolerant. Case-sensitive site-name
// match — production casing inconsistencies (e.g. "Acme" vs "ACME") are
// out of scope and tracked in _blockers.md if observed.
// ---------------------------------------------------------------------------

const SEPARATORS = [" - ", " | ", " – ", " — "] as const;

export interface DeriveAltTextInput {
  seoTitle: string | null | undefined;
  siteName: string | null | undefined;
  postTitleFallback: string;
}

export function deriveAltText(input: DeriveAltTextInput): string {
  const seo = (input.seoTitle ?? "").trim();
  if (!seo) return input.postTitleFallback;

  const site = (input.siteName ?? "").trim();
  if (!site) return seo;

  // Strip trailing " {sep}{siteName}" — first matching separator wins,
  // mirroring the order in the spec.
  for (const sep of SEPARATORS) {
    const pattern = `${sep}${site}`;
    if (seo.endsWith(pattern)) {
      const stripped = seo.slice(0, seo.length - pattern.length).trim();
      return stripped || seo;
    }
  }
  return seo;
}
