import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { internalError, validationError } from "@/lib/http";
import { getRedisClient } from "@/lib/redis";
import { assertSafeUrl, SsrfBlockedError } from "@/lib/ssrf-guard";

// ---------------------------------------------------------------------------
// POST /api/platform/social/link-preview
// Body: { company_id: string; url: string }
//
// Fetches Open Graph / meta tags from the given URL, returns structured
// preview data. Results are cached in Upstash Redis for 1 hour.
// Falls back gracefully when OG tags are missing or the page is unavailable.
//
// Returns: { ok, data: { title, description, image_url, domain, fetched_at } }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 3600;
const FETCH_TIMEOUT_MS = 5_000;
const UUID_RE = /^[0-9a-f-]{36}$/i;

// Regex patterns for extracting Open Graph and standard meta tags.
// These handle both single and double quotes, and attribute order variation.
function extractMeta(html: string): {
  title: string | null;
  description: string | null;
  image_url: string | null;
} {
  function getMetaContent(pattern: RegExp): string | null {
    const m = pattern.exec(html);
    return m ? (m[1] ?? m[2] ?? null) : null;
  }

  const ogTitle = getMetaContent(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*?)["']/i,
  ) ?? getMetaContent(
    /<meta[^>]+content=["']([^"']*?)["'][^>]+property=["']og:title["']/i,
  );

  const ogDesc = getMetaContent(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*?)["']/i,
  ) ?? getMetaContent(
    /<meta[^>]+content=["']([^"']*?)["'][^>]+property=["']og:description["']/i,
  );

  const ogImage = getMetaContent(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*?)["']/i,
  ) ?? getMetaContent(
    /<meta[^>]+content=["']([^"']*?)["'][^>]+property=["']og:image["']/i,
  );

  const metaDesc = getMetaContent(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*?)["']/i,
  ) ?? getMetaContent(
    /<meta[^>]+content=["']([^"']*?)["'][^>]+name=["']description["']/i,
  );

  const pageTitle = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1] ?? null;

  return {
    title: ogTitle ?? pageTitle,
    description: ogDesc ?? metaDesc,
    image_url: ogImage,
  };
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function cacheKey(url: string): string {
  return `link_preview:${createHash("sha256").update(url).digest("hex")}`;
}

type LinkPreviewData = {
  title: string | null;
  description: string | null;
  image_url: string | null;
  domain: string;
  fetched_at: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validationError("Invalid JSON body.");
  }

  const { company_id, url } = body as { company_id?: unknown; url?: unknown };

  if (typeof company_id !== "string" || !UUID_RE.test(company_id)) {
    return validationError("company_id (uuid) is required.");
  }
  if (typeof url !== "string" || !url.trim()) {
    return validationError("url (string) is required.");
  }

  // Auth gate first — don't do URL parsing or SSRF checks for unauthorised callers.
  const gate = await requireCanDoForApi(company_id, "edit_post");
  if (gate.kind === "deny") return gate.response;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return validationError("url must be a valid absolute URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return validationError("url must use http or https protocol.");
  }

  // DI-006: SSRF guard — block private/loopback/link-local IPs (e.g.
  // 169.254.169.254 metadata endpoints). Mirrors the pattern in
  // app/api/admin/images/fetch-url/route.ts:66.
  try {
    await assertSafeUrl(parsed.href);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return validationError("URL is not allowed.");
    }
    return internalError("Failed to validate URL.");
  }

  const normalizedUrl = parsed.href;
  const domain = extractDomain(normalizedUrl);
  const redis = getRedisClient();

  // Check Redis cache first
  if (redis) {
    const key = cacheKey(normalizedUrl);
    try {
      const cached = await redis.get<LinkPreviewData>(key);
      if (cached) {
        return NextResponse.json({ ok: true, data: cached });
      }
    } catch {
      // Cache miss or Redis unavailable — fall through to fetch
    }
  }

  // Fetch the page
  let html: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(normalizedUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Opollo-LinkPreview/1.0 (+https://opollo.com)",
          "Accept": "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });

      if (!res.ok) {
        const data: LinkPreviewData = {
          title: null,
          description: null,
          image_url: null,
          domain,
          fetched_at: new Date().toISOString(),
        };
        return NextResponse.json(
          { ok: false, data, error: { code: "FETCH_FAILED", status: res.status } },
          { status: 200 },
        );
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        const data: LinkPreviewData = {
          title: url,
          description: null,
          image_url: null,
          domain,
          fetched_at: new Date().toISOString(),
        };
        return NextResponse.json({ ok: true, data });
      }

      html = await res.text();
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const data: LinkPreviewData = {
      title: isTimeout ? null : null,
      description: null,
      image_url: null,
      domain,
      fetched_at: new Date().toISOString(),
    };
    return NextResponse.json(
      {
        ok: false,
        data,
        error: {
          code: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
          message: isTimeout ? "Request timed out" : "Network error",
        },
      },
      { status: 200 },
    );
  }

  const { title, description, image_url } = extractMeta(html);
  const result: LinkPreviewData = {
    title,
    description,
    image_url,
    domain,
    fetched_at: new Date().toISOString(),
  };

  // Cache in Redis (fire and forget — don't block the response)
  if (redis) {
    const key = cacheKey(normalizedUrl);
    void redis.set(key, result, { ex: CACHE_TTL_SECONDS }).catch(() => {});
  }

  return NextResponse.json({ ok: true, data: result });
}
