import "server-only";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 17 — Source-page fetcher.
//
// Pulls the live HTML of a landing page so the import-mode brief-
// runner has a snapshot to reproduce. Plain HTTP fetch only — JS-
// rendered pages will return the SSR/initial HTML, which is usually
// fine for marketing pages but loses any client-side hydrated content.
// A Playwright fallback is documented as a future upgrade if it
// becomes a real friction point.
//
// Limits:
//   - 30s timeout
//   - 5MB body cap
//   - http(s) only
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 5 * 1024 * 1024;

export interface FetchSourceInput {
  url: string;
}

export type FetchSourceResult =
  | {
      ok: true;
      url: string;
      final_url: string;
      html: string;
      body_size: number;
      content_type: string | null;
      fetched_at: string;
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

export async function fetchSourcePage(
  input: FetchSourceInput,
): Promise<FetchSourceResult> {
  const url = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "Source URL could not be parsed.",
      },
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      error: {
        code: "INVALID_URL",
        message: "Source URL must be http:// or https://.",
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
    clearTimeout(timeout);
    return {
      ok: false,
      error: {
        code: "FETCH_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  clearTimeout(timeout);

  if (!res.ok) {
    return {
      ok: false,
      error: {
        code: "HTTP_ERROR",
        message: `Source responded ${res.status}.`,
      },
    };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    return {
      ok: false,
      error: {
        code: "NO_BODY",
        message: "Source response had no body.",
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
            message: `Source exceeded ${MAX_BYTES} bytes.`,
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
  const html = buffer.toString("utf8");

  return {
    ok: true,
    url,
    final_url: res.url || url,
    html,
    body_size: buffer.byteLength,
    content_type: res.headers.get("content-type"),
    fetched_at: new Date().toISOString(),
  };
}
