// ---------------------------------------------------------------------------
// M4-7 — HTML image URL rewriter.
//
// Swaps Cloudflare-delivered image URLs inside generated page HTML for
// the client WP site's media library URL. Used by batch-publisher.ts
// immediately before calling wp.create / wp.update, so the page the
// client's WordPress serves references images the client's WP owns.
//
// Design decisions:
//
//   1. Targeted, not general. Only Cloudflare imagedelivery.net URLs
//      are considered for rewriting. External images, relative URLs,
//      `data:` URIs, and URLs we don't recognise are left untouched.
//      This keeps the rewrite safe to run on any HTML we generate —
//      there's no attack surface against unrecognised URL shapes.
//
//   2. Attribute-scoped. The rewriter only touches `src=`, `srcset=`,
//      and `style="...background-image: url(...)..."`. Text content
//      containing a URL-looking string is never rewritten.
//
//   3. srcset descriptor-safe. `srcset` values carry multiple URLs
//      separated by commas, each with an optional width/density
//      descriptor (`1x`, `2x`, `640w`). We parse the comma-separated
//      list, rewrite the URL portion of each entry, and preserve the
//      descriptor.
//
//   4. Missing mapping = keep original. If a Cloudflare id appears in
//      the HTML but no WP URL exists for it, we preserve the original
//      URL and report the miss via the result. Publish stage decides
//      whether to abort.
//
//   5. Not parser-based. The parent plan mentions parser-based as a
//      goal; we use targeted regex scoped to well-known Cloudflare
//      URL shapes. The shapes are ones WE generate, not arbitrary
//      HTML the model wrote, so the attack-surface trade-off favours
//      zero new dependencies. A parser-based implementation is a
//      drop-in rewrite if the constraint ever widens.
// ---------------------------------------------------------------------------

// imagedelivery.net/<HASH>/<id>/<variant>[?query]
// HASH is 22 chars of [A-Za-z0-9_-]; id is 36-char UUID shape (any safe chars);
// variant is alphanumeric / dashes / underscores.
const CLOUDFLARE_URL_RE =
  /https?:\/\/imagedelivery\.net\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)\/[A-Za-z0-9_-]+(?:\?[^\s"']*)?/g;

export type RewriteMapping = ReadonlyMap<string, string>;

export type RewriteResult = {
  rewrittenHtml: string;
  usedIds: Set<string>;
  missedIds: Set<string>;
  rewriteCount: number;
};

type Counter = { n: number };

function rewriteOneUrl(
  url: string,
  mapping: RewriteMapping,
  usedIds: Set<string>,
  missedIds: Set<string>,
  counter: Counter,
): string {
  CLOUDFLARE_URL_RE.lastIndex = 0;
  const match = CLOUDFLARE_URL_RE.exec(url);
  if (!match) return url;
  const cfId = match[1]!;
  const wpUrl = mapping.get(cfId);
  if (!wpUrl) {
    missedIds.add(cfId);
    return url;
  }
  usedIds.add(cfId);
  counter.n++;
  return wpUrl;
}

function rewriteSrcsetValue(
  value: string,
  mapping: RewriteMapping,
  usedIds: Set<string>,
  missedIds: Set<string>,
  counter: Counter,
): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim();
      if (trimmed.length === 0) return "";
      // Each entry is "<url>[ <descriptor>]"
      const spaceIdx = trimmed.search(/\s/);
      const rawUrl = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const descriptor = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx);
      const rewritten = rewriteOneUrl(
        rawUrl,
        mapping,
        usedIds,
        missedIds,
        counter,
      );
      return `${rewritten}${descriptor}`;
    })
    .filter((p) => p.length > 0)
    .join(", ");
}

// Attribute matchers. Quote-style agnostic. Non-greedy values.
const SRC_ATTR_RE =
  /\b(src|srcset)\s*=\s*("([^"]*)"|'([^']*)')/gi;
const STYLE_ATTR_RE =
  /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
const BG_URL_RE =
  /(background(?:-image)?\s*:\s*[^;"']*?url\(\s*)(['"]?)([^'")]+)(\2)(\s*\))/gi;

/**
 * Walk `html` and swap every Cloudflare-delivered URL whose cloudflare
 * id is in `mapping`. Returns the rewritten HTML + a summary of which
 * ids were applied and which appeared in the HTML but had no mapping
 * entry.
 */
export function rewriteImageUrls(
  html: string,
  mapping: RewriteMapping,
): RewriteResult {
  const usedIds = new Set<string>();
  const missedIds = new Set<string>();
  const counter: Counter = { n: 0 };

  const step1 = html.replace(
    SRC_ATTR_RE,
    (_whole, attr: string, _full: string, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? "";
      const quote = dq !== undefined ? '"' : "'";
      const lower = (attr as string).toLowerCase();
      const next =
        lower === "src"
          ? rewriteOneUrl(value, mapping, usedIds, missedIds, counter)
          : rewriteSrcsetValue(value, mapping, usedIds, missedIds, counter);
      return `${attr}=${quote}${next}${quote}`;
    },
  );

  const step2 = step1.replace(
    STYLE_ATTR_RE,
    (_whole, _full: string, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? "";
      const quote = dq !== undefined ? '"' : "'";
      const nextValue = value.replace(
        BG_URL_RE,
        (
          _w,
          prefix: string,
          innerQuote: string,
          urlBody: string,
          _innerQuoteClose: string,
          suffix: string,
        ) => {
          const rewritten = rewriteOneUrl(
            urlBody,
            mapping,
            usedIds,
            missedIds,
            counter,
          );
          return `${prefix}${innerQuote}${rewritten}${innerQuote}${suffix}`;
        },
      );
      return `style=${quote}${nextValue}${quote}`;
    },
  );

  return {
    rewrittenHtml: step2,
    usedIds,
    missedIds,
    rewriteCount: counter.n,
  };
}

/**
 * Return the set of distinct Cloudflare image ids referenced anywhere
 * in the HTML. Used by the publish stage to decide which images need
 * WP media transfer before the rewrite.
 */
export function extractCloudflareIds(html: string): Set<string> {
  const ids = new Set<string>();
  CLOUDFLARE_URL_RE.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = CLOUDFLARE_URL_RE.exec(html)) !== null) {
    ids.add(match[1]!);
  }
  return ids;
}
