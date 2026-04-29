import "server-only";

// ---------------------------------------------------------------------------
// Page content analysis (spec §8 / §9, plus the page-content-analysis
// skill). Extracts H1, H2s, primary CTA verb, hero copy, and an "offer
// statement" candidate from rendered page HTML. Phase 1 uses fast
// regex-based parsing — works for the static, server-rendered shape the
// Site Builder produces. Pages with heavy client-side rendering may
// return partial results; staff see this as an "offer not stated above
// fold" reason in the playbook trigger output, not a hard failure.
// ---------------------------------------------------------------------------

export type PageSnapshot = {
  url: string;
  fetched_at: string;
  /** Title from <title>. */
  title: string | null;
  /** First H1, text-only. */
  h1: string | null;
  /** Up to 5 H2s, text-only, in document order. */
  h2s: string[];
  /** First button / link inside the first form, or the first prominent
   * CTA-shaped element. Returns the verb (first word) plus the full text. */
  primary_cta: { verb: string | null; text: string } | null;
  /** First 600 chars of body text inside the first <main> / <article>
   * (or the document body). Used as a quick "above-the-fold proxy". */
  hero_excerpt: string | null;
  /** TRUE if the doc contains at least one <form>. */
  has_form: boolean;
  /** Lower-case form field count (input/select/textarea, excluding hidden). */
  form_field_count: number;
  /** Heuristic: TRUE if the offer (as detected) appears in the first ~600 chars. */
  offer_above_fold: boolean;
  /** Heuristic: TRUE if a CTA appears in the first ~1200 chars. */
  cta_above_fold: boolean;
};

const HERO_LIMIT = 600;
const ABOVE_FOLD_LIMIT = 1200;

export function analyseHtml(url: string, html: string): PageSnapshot {
  const title = extract(html, /<title[^>]*>([^<]*)<\/title>/i);
  const h1 = stripTags(extract(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i));
  const h2Matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)];
  const h2s = h2Matches.slice(0, 5).map((m) => stripTags(m[1]) ?? "").filter(Boolean);
  const heroExcerpt = extractHeroExcerpt(html);

  const cta = extractPrimaryCta(html);
  const hasForm = /<form[\s>]/i.test(html);
  const formFieldCount = countFormFields(html);

  const headFold = (title ?? "") + " " + (h1 ?? "") + " " + (heroExcerpt ?? "");
  const offerAboveFold = detectOfferAboveFold(headFold);
  const ctaAboveFold = (() => {
    if (!cta) return false;
    const idx = html.toLowerCase().indexOf(cta.text.toLowerCase());
    return idx !== -1 && idx <= ABOVE_FOLD_LIMIT;
  })();

  return {
    url,
    fetched_at: new Date().toISOString(),
    title,
    h1,
    h2s,
    primary_cta: cta,
    hero_excerpt: heroExcerpt,
    has_form: hasForm,
    form_field_count: formFieldCount,
    offer_above_fold: offerAboveFold,
    cta_above_fold: ctaAboveFold,
  };
}

function extract(s: string, re: RegExp): string | null {
  const m = s.match(re);
  return m ? m[1].trim() : null;
}

function stripTags(s: string | null): string | null {
  if (s == null) return null;
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHeroExcerpt(html: string): string | null {
  const mainBlock =
    extract(html, /<main[^>]*>([\s\S]*?)<\/main>/i) ??
    extract(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ??
    extract(html, /<body[^>]*>([\s\S]*?)<\/body>/i) ??
    html;
  const text = stripTags(mainBlock) ?? "";
  return text ? text.slice(0, HERO_LIMIT) : null;
}

function extractPrimaryCta(
  html: string,
): { verb: string | null; text: string } | null {
  // Form submit buttons take precedence — they're explicit conversion
  // points. Then any prominent <button> or anchor inside the first
  // ~3000 chars of body.
  const formButton = html.match(
    /<form[\s\S]*?<(button|input)[^>]*type=["']?submit["']?[^>]*>([\s\S]*?)<\/(button|input)>/i,
  );
  let raw: string | null = null;
  if (formButton) {
    raw = stripTags(formButton[2]);
  }
  if (!raw) {
    const button = html.slice(0, 3000).match(
      /<button[^>]*>([\s\S]*?)<\/button>/i,
    );
    if (button) raw = stripTags(button[1]);
  }
  if (!raw) {
    const link = html.slice(0, 3000).match(
      /<a[^>]*class=["'][^"']*(cta|btn)[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (link) raw = stripTags(link[2]);
  }
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const firstWord = text.split(/\s+/)[0]?.toLowerCase();
  return { verb: firstWord ?? null, text };
}

function countFormFields(html: string): number {
  const formMatch = html.match(/<form[\s\S]*?<\/form>/i);
  if (!formMatch) return 0;
  const formHtml = formMatch[0];
  const inputs = formHtml.match(
    /<(input|select|textarea)[^>]*type=["'](?!hidden)[^"']+["'][^>]*>/gi,
  ) ?? [];
  const inputsNoType = formHtml.match(/<(select|textarea)[^>]*>/gi) ?? [];
  return inputs.length + inputsNoType.length;
}

function detectOfferAboveFold(text: string): boolean {
  // Coarse heuristic — we don't know the offer text yet, but a page
  // that says "Get a free consultation" / "Book a demo" / "Save 30%" /
  // "Free trial" / similar in the head fold is the §9.6.1 baseline
  // for "offer stated". A fuller LLM-driven check lands as an opt-in
  // alongside the alignment LLM augmentation pass.
  const lower = text.toLowerCase();
  return /(free (consult|trial|quote|estimate)|book a (demo|call|consult)|save \d|money back|guarantee|no credit card|same[- ]day)/.test(
    lower,
  );
}
