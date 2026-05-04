import { randomUUID } from "node:crypto";

import { parse as parseExif } from "exifr";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  CloudflareCallError,
  deliveryUrl,
  uploadImageFromBytes,
} from "@/lib/cloudflare-images";
import { readImageDimensions } from "@/lib/image-dimensions";
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
  const dims = readImageDimensions(bytes);

  // Extract EXIF/IPTC/XMP metadata. NEVER block the upload on failure.
  let exifCaption: string | null = null;
  let exifAltText: string | null = null;
  let exifTags: string[] = [];
  let exifRaw: Record<string, unknown> | null = null;
  try {
    const exif = await parseExif(bytes.buffer as ArrayBuffer, {
      tiff: true,
      xmp: true,
      iptc: true,
      icc: false,
      reviveValues: true,
    }) as Record<string, unknown> | undefined;
    if (exif) {
      exifRaw = exif;
      const cap =
        (exif.ImageDescription as string | undefined) ??
        (exif.Caption as string | undefined) ??
        (exif.Headline as string | undefined) ??
        null;
      exifCaption = cap?.trim() || null;
      const alt =
        (exif.AltTextAccessibility as string | undefined) ??
        (exif.AltText as string | undefined) ??
        null;
      exifAltText = alt?.trim() || null;
      const kw = exif.Keywords;
      if (typeof kw === "string" && kw.trim()) {
        exifTags = kw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      } else if (Array.isArray(kw)) {
        exifTags = (kw as string[]).map((s) => String(s).trim()).filter(Boolean);
      }
    }
  } catch (err) {
    logger.warn("image.upload.exif_parse_failed", {
      filename,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Optional duplicate-handling: ?replace=1 archives any active row with
  // the same filename before the new upload lands so the new row can
  // own the (filename) namespace. Skip mode is enforced client-side via
  // /api/admin/images/check-existing — by the time we reach this
  // endpoint the operator already chose to upload this file.
  const url = new URL(req.url);
  const replaceExisting = url.searchParams.get("replace") === "1";
  if (replaceExisting && filename) {
    const supabaseLookup = getServiceRoleClient();
    const dup = await supabaseLookup
      .from("image_library")
      .select("id")
      .eq("filename", filename)
      .is("deleted_at", null)
      .maybeSingle();
    if (dup.data?.id) {
      const archived = await supabaseLookup
        .from("image_library")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: gate.user?.id ?? null,
        })
        .eq("id", dup.data.id);
      if (archived.error) {
        logger.error("image.upload.replace_archive_failed", {
          existing_id: dup.data.id,
          error: archived.error.message,
        });
      }
    }
  }

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
    width_px: dims?.width ?? null,
    height_px: dims?.height ?? null,
    caption: exifCaption,
    alt_text: exifAltText,
    tags: exifTags.length > 0 ? exifTags : [],
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

  // Persist raw EXIF object in image_metadata for later inspection /
  // re-extraction without blocking the response.
  if (exifRaw && ins.data?.id) {
    supabase
      .from("image_metadata")
      .insert({ image_id: ins.data.id, key: "exif_raw", value_jsonb: exifRaw })
      .then(({ error }) => {
        if (error) {
          logger.warn("image.upload.exif_metadata_insert_failed", {
            image_id: ins.data!.id,
            error: error.message,
          });
        }
      });
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
