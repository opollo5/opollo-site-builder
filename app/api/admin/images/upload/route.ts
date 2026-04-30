import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  CloudflareCallError,
  deliveryUrl,
  uploadImageFromBytes,
} from "@/lib/cloudflare-images";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/images/upload — BP-5.
//
// Multipart upload of a single image file. Pushes to Cloudflare Images
// then inserts an image_library row with source='upload'. Returns the
// new row including the Cloudflare delivery URL so the picker can
// auto-select it.
//
// Captioning is intentionally NOT done synchronously — the operator
// shouldn't wait 5-15s for an Anthropic round-trip when they just want
// the image. The caption stays NULL; FTS still matches the filename.
// A future caption-backfill worker (or operator edit) fills it in.
//
// Auth: admin OR operator.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_PREFIX = "image/";

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: code !== "VALIDATION_FAILED" },
      timestamp: new Date().toISOString(),
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return errorJson("VALIDATION_FAILED", "Request body must be multipart/form-data.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorJson("VALIDATION_FAILED", "Field `file` is required and must be a File.", 400);
  }
  if (file.size === 0) {
    return errorJson("VALIDATION_FAILED", "Uploaded file is empty.", 400);
  }
  if (file.size > MAX_BYTES) {
    return errorJson(
      "FILE_TOO_LARGE",
      `Image exceeds the 10 MB cap (got ${Math.round(file.size / 1024 / 1024)} MB).`,
      413,
    );
  }
  if (!file.type.startsWith(ALLOWED_MIME_PREFIX)) {
    return errorJson(
      "UNSUPPORTED_TYPE",
      `Uploaded file is "${file.type || "unknown"}". Pick a JPEG, PNG, GIF, or WebP image.`,
      415,
    );
  }

  const cloudflareId = `opollo/upload/${randomUUID()}`;
  const filename = file.name || `${cloudflareId}.bin`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  let cfRecord;
  try {
    cfRecord = await uploadImageFromBytes({
      id: cloudflareId,
      bytes,
      filename,
      contentType: file.type,
    });
  } catch (err) {
    if (err instanceof CloudflareCallError) {
      logger.error("image.upload.cloudflare_failed", {
        cloudflare_id: cloudflareId,
        cf_code: err.code,
        retryable: err.retryable,
        detail: err.message,
      });
      return errorJson(
        err.retryable ? "UPSTREAM_RETRYABLE" : "UPSTREAM_REJECTED",
        `Cloudflare upload failed (${err.code}). ${err.retryable ? "Try again." : "Pick a different image."}`,
        err.retryable ? 502 : 400,
      );
    }
    logger.error("image.upload.unexpected", {
      cloudflare_id: cloudflareId,
      error: err instanceof Error ? err.message : String(err),
    });
    return errorJson(
      "INTERNAL_ERROR",
      "Cloudflare upload failed unexpectedly.",
      500,
    );
  }

  const supabase = getServiceRoleClient();
  const insertRow = {
    cloudflare_id: cfRecord.id,
    filename,
    source: "upload" as const,
    source_ref: filename,
    bytes: file.size,
    created_by: gate.user?.id ?? null,
  };
  const ins = await supabase
    .from("image_library")
    .insert(insertRow)
    .select(
      "id, cloudflare_id, filename, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at",
    )
    .single();

  if (ins.error) {
    // 23505 = duplicate cloudflare_id (idempotency replay or race) —
    // still a useful end-state, fetch the existing row and return it.
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
            data: {
              ...existing.data,
              delivery_url: deliveryUrl(cfRecord.id),
            },
            timestamp: new Date().toISOString(),
          },
          { status: 200, headers: { "cache-control": "no-store" } },
        );
      }
    }
    logger.error("image.upload.insert_failed", {
      cloudflare_id: cfRecord.id,
      error: ins.error.message,
    });
    return errorJson(
      "INTERNAL_ERROR",
      "Image uploaded to Cloudflare but failed to save in library.",
      500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        ...ins.data,
        delivery_url: deliveryUrl(cfRecord.id),
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
