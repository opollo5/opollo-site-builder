import "server-only";

import { logger } from "@/lib/logger";
import type { FullPageChrome } from "@/lib/full-page-output";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 14 — Lazy chrome extraction.
//
// First time a client runs a full_page generation and the cached
// site_conventions.full_page_chrome is NULL, fetch the live homepage
// HTML, extract <header> / <nav> / <footer>, return them as a
// FullPageChrome record for the caller to UPSERT.
//
// Limitations (acceptable for v1):
//   - Plain HTTP fetch — no JS rendering. Sites that build chrome via
//     client-side JS will return empty extraction; caller falls back
//     to default chrome (or surfaces the gap to operator).
//   - Naive regex extraction. Modern sites usually have one each of
//     <header> / <nav> / <footer> at the document level — this works
//     for ~80% of the WP themes out there. For the rest, the operator
//     can manually populate site_conventions.full_page_chrome via SQL.
//   - 30s fetch timeout, 5MB max body. Hosting credentials tend to be
//     fine on these limits; if not, the caller treats failure the
//     same as "not yet extracted" and either re-tries later or
//     surfaces to the operator.
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;

export type ExtractChromeResult =
  | { ok: true; chrome: FullPageChrome }
  | { ok: false; error: { code: string; message: string } };

export async function extractFullPageChrome(
  homepageUrl: string,
): Promise<ExtractChromeResult> {
  const html = await fetchHomepage(homepageUrl);
  if (!html.ok) return html;

  const header = extractTag(html.body, "header");
  const nav = extractTag(html.body, "nav");
  const footer = extractTag(html.body, "footer");

  if (!header && !nav && !footer) {
    return {
      ok: false,
      error: {
        code: "NO_CHROME_FOUND",
        message:
          "Could not locate <header>, <nav>, or <footer> at the document level. Site may render chrome via client-side JS.",
      },
    };
  }

  return {
    ok: true,
    chrome: {
      header_html: header ?? "",
      nav_html: nav ?? "",
      footer_html: footer ?? "",
      source_url: homepageUrl,
      extracted_at: new Date().toISOString(),
    },
  };
}

interface FetchResult {
  ok: true;
  body: string;
}

async function fetchHomepage(
  url: string,
): Promise<FetchResult | { ok: false; error: { code: string; message: string } }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "Homepage URL could not be parsed.",
      },
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "Homepage URL must be http:// or https://.",
      },
    };
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Opollo-Optimiser/1.5 (+https://mgmt.opollo.com)",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "FETCH_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    return {
      ok: false,
      error: {
        code: "HTTP_ERROR",
        message: `Homepage responded ${res.status}.`,
      },
    };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      error: {
        code: "NO_BODY",
        message: "Homepage response had no body.",
      },
    };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        return {
          ok: false,
          error: {
            code: "BODY_TOO_LARGE",
            message: `Homepage exceeded ${MAX_BYTES} bytes.`,
          },
        };
      }
      chunks.push(value);
    }
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "READ_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const body = buffer.toString("utf8");
  return { ok: true, body };
}

// Minimal HTML tag extractor. Matches the FIRST occurrence of
// `<tag …>…</tag>` allowing nested same-name elements via a balanced-
// counter walk (browsers tolerate one document-level <header>, but
// some themes nest <header> inside <article>; we only want the
// document-level one).
function extractTag(html: string, tag: string): string | null {
  const lower = html.toLowerCase();
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "g");
  const openMatch = openRe.exec(lower);
  if (!openMatch) return null;
  const startIdx = openMatch.index;

  // Walk forward, tracking tag depth, until the matching close.
  let depth = 1;
  let pos = openRe.lastIndex;
  const closeOpen = `<${tag}`;
  const closeClose = `</${tag}>`;
  while (pos < lower.length && depth > 0) {
    const nextOpen = lower.indexOf(closeOpen, pos);
    const nextClose = lower.indexOf(closeClose, pos);
    if (nextClose === -1) return null;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + closeOpen.length;
    } else {
      depth -= 1;
      pos = nextClose + closeClose.length;
      if (depth === 0) {
        return html.slice(startIdx, pos);
      }
    }
  }
  // Unbalanced — bail rather than return a malformed slice.
  logger.warn("full-page-chrome-extractor: unbalanced tag", { tag });
  return null;
}
