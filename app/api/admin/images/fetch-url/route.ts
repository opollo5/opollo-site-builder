import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  CloudflareCallError,
  deliveryUrl,
  uploadImageFromBytes,
} from "@/lib/cloudflare-images";
import { logger } from "@/lib/logger";
import { assertSafeUrl, SsrfBlockedError } from "@/lib/ssrf-guard";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/images/fetch-url — BP-6.
//
// Body: { url }
// Server: assertSafeUrl (SSRF guard) → HEAD probe (size + content-type)
//   → GET (10 MB cap, 30s timeout) → uploadImageFromBytes →
//   image_library insert. Returns the new row + delivery_url for
//   auto-select.
//
// Auth: admin OR operator.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const ALLOWED_MIME_PREFIX = "image/";

const BodySchema = z.object({
  url: z.string().url().max(2048),
});

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        retryable: code === "UPSTREAM_RETRYABLE",
        ...(details ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson("VALIDATION_FAILED", "Body must be { url: string }.", 400);
  }
  const url = parsed.data.url;

  try {
    await assertSafeUrl(url);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      logger.warn("image.fetch_url.ssrf_blocked", {
        url,
        reason: err.reason,
        ...(err.details ?? {}),
      });
      return errorJson(
        "URL_BLOCKED",
        "That URL points to an internal or unsupported address.",
        400,
        { reason: err.reason },
      );
    }
    throw err;
  }

  // HEAD probe — cheap rejection for oversize / wrong-type.
  let headRes: Response;
  try {
    headRes = await fetchWithTimeout(
      url,
      { method: "HEAD" },
      FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    return errorJson(
      "FETCH_FAILED",
      `HEAD probe failed: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
  if (!headRes.ok) {
    return errorJson(
      "FETCH_FAILED",
      `Source server returned ${headRes.status} on HEAD.`,
      502,
    );
  }
  const contentType = headRes.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(ALLOWED_MIME_PREFIX)) {
    return errorJson(
      "UNSUPPORTED_TYPE",
      `URL serves "${contentType || "unknown"}" — not an image.`,
      415,
    );
  }
  const contentLength = Number(headRes.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    return errorJson(
      "FILE_TOO_LARGE",
      `Source advertises ${Math.round(contentLength / 1024 / 1024)} MB — over the 10 MB cap.`,
      413,
    );
  }

  // GET the bytes.
  let getRes: Response;
  try {
    getRes = await fetchWithTimeout(url, { method: "GET" }, FETCH_TIMEOUT_MS);
  } catch (err) {
    return errorJson(
      "FETCH_FAILED",
      `GET failed: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
  if (!getRes.ok) {
    return errorJson(
      "FETCH_FAILED",
      `Source server returned ${getRes.status} on GET.`,
      502,
    );
  }
  const bytes = new Uint8Array(await getRes.arrayBuffer());
  if (bytes.byteLength === 0) {
    return errorJson("FETCH_FAILED", "Source returned an empty body.", 502);
  }
  if (bytes.byteLength > MAX_BYTES) {
    // HEAD may have been honest about size, then GET returned more
    // (chunked, no content-length). Hard cap regardless.
    return errorJson(
      "FILE_TOO_LARGE",
      `Fetched body is ${Math.round(bytes.byteLength / 1024 / 1024)} MB — over the 10 MB cap.`,
      413,
    );
  }

  // Upload to Cloudflare.
  const cloudflareId = `opollo/url/${randomUUID()}`;
  const filename = (() => {
    try {
      const u = new URL(url);
      const last = u.pathname.split("/").filter(Boolean).pop();
      return last ?? cloudflareId;
    } catch {
      return cloudflareId;
    }
  })();
  let cfRecord;
  try {
    cfRecord = await uploadImageFromBytes({
      id: cloudflareId,
      bytes,
      filename,
      contentType: getRes.headers.get("content-type") ?? contentType,
    });
  } catch (err) {
    if (err instanceof CloudflareCallError) {
      logger.error("image.fetch_url.cloudflare_failed", {
        cloudflare_id: cloudflareId,
        cf_code: err.code,
        retryable: err.retryable,
      });
      return errorJson(
        err.retryable ? "UPSTREAM_RETRYABLE" : "UPSTREAM_REJECTED",
        `Cloudflare upload failed (${err.code}).`,
        err.retryable ? 502 : 400,
      );
    }
    return errorJson("INTERNAL_ERROR", "Cloudflare upload failed.", 500);
  }

  const supabase = getServiceRoleClient();
  const ins = await supabase
    .from("image_library")
    .insert({
      cloudflare_id: cfRecord.id,
      filename,
      source: "upload" as const,
      source_ref: url,
      bytes: bytes.byteLength,
      created_by: gate.user?.id ?? null,
    })
    .select(
      "id, cloudflare_id, filename, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at",
    )
    .single();

  if (ins.error) {
    if (ins.error.code === "23505") {
      const existing = await supabase
        .from("image_library")
        .select(
          "id, cloudflare_id, filename, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at",
        )
        .eq("cloudflare_id", cfRecord.id)
        .maybeSingle();
      if (existing.data) {
        return NextResponse.json(
          {
            ok: true,
            data: { ...existing.data, delivery_url: deliveryUrl(cfRecord.id) },
            timestamp: new Date().toISOString(),
          },
          { status: 200, headers: { "cache-control": "no-store" } },
        );
      }
    }
    return errorJson(
      "INTERNAL_ERROR",
      "Image fetched but failed to save in library.",
      500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { ...ins.data, delivery_url: deliveryUrl(cfRecord.id) },
      timestamp: new Date().toISOString(),
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
