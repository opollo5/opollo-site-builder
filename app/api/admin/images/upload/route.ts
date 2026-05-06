import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  CloudflareCallError,
  deliveryUrl,
  uploadImageFromBytes,
} from "@/lib/cloudflare-images";
import { extractExifFields } from "@/lib/exif-extract";
import { internalError, routeError, validationError } from "@/lib/http";
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
const AI_CAPTION_MAX_BYTES = 5 * 1024 * 1024;

async function generateAiCaption(
  imageId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  // Downscale large images: Anthropic vision accepts up to ~5 MB base64.
  // Skip if the file is too large to avoid excessive token spend.
  if (bytes.length > AI_CAPTION_MAX_BYTES) return;

  const base64 = Buffer.from(bytes).toString("base64");
  const mediaType = mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif";

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: 'Describe this image concisely in one sentence for use as a photo caption (max 150 chars). Then on a new line write a short alt text for accessibility (max 100 chars). Format:\nCAPTION: <caption>\nALT: <alt text>',
            },
          ],
        },
      ],
    });

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    const captionMatch = /^CAPTION:\s*(.+)/m.exec(text);
    const altMatch = /^ALT:\s*(.+)/m.exec(text);
    const aiCaption = captionMatch?.[1]?.trim().slice(0, 150) ?? null;
    const aiAlt = altMatch?.[1]?.trim().slice(0, 100) ?? null;

    if (!aiCaption && !aiAlt) return;

    const svc = getServiceRoleClient();
    await svc
      .from("image_library")
      .update({
        ...(aiCaption ? { caption: aiCaption } : {}),
        ...(aiAlt ? { alt_text: aiAlt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", imageId)
      .is("caption", null);
  } catch (err) {
    logger.warn("image.upload.ai_caption_failed", {
      image_id: imageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function deriveTitle(
  raw: Record<string, unknown> | null,
  filename: string | null,
): string | null {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  if (raw) {
    const t =
      str(raw.ObjectName) ??
      str(raw.Headline) ??
      str(raw.Title) ??
      (str(raw["Caption-Abstract"])?.slice(0, 80) ?? null) ??
      (str(raw.description)?.slice(0, 80) ?? null);
    if (t) return t;
  }
  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, "");
  const m = /^istock[-_](\d+)/i.exec(base);
  if (m) return `iStock Image ${m[1]}`;
  const human = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return human || null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const form = await req.formData().catch(() => null);
  if (!form) {
    return validationError("Request body must be multipart/form-data.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return validationError("Field `file` is required and must be a File.");
  }
  if (file.size === 0) {
    return validationError("Uploaded file is empty.");
  }
  if (file.size > MAX_BYTES) {
    return routeError("FILE_TOO_LARGE", `Image exceeds the 10 MB cap (got ${Math.round(file.size / 1024 / 1024)} MB).`);
  }
  if (!file.type.startsWith(ALLOWED_MIME_PREFIX)) {
    return routeError("UNSUPPORTED_TYPE", `Uploaded file is "${file.type || "unknown"}". Pick a JPEG, PNG, GIF, or WebP image.`);
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
    const exifFields = await extractExifFields(bytes.buffer as ArrayBuffer);
    if (exifFields) {
      exifCaption = exifFields.caption;
      exifAltText = exifFields.alt_text;
      exifTags = exifFields.tags;
      exifRaw = exifFields.raw;
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
      return routeError(
        err.retryable ? "UPSTREAM_RETRYABLE" : "UPSTREAM_REJECTED",
        `Cloudflare upload failed (${err.code}). ${err.retryable ? "Try again." : "Pick a different image."}`,
      );
    }
    logger.error("image.upload.unexpected", {
      cloudflare_id: cloudflareId,
      error: err instanceof Error ? err.message : String(err),
    });
    return internalError("Cloudflare upload failed unexpectedly.");
  }

  const supabase = getServiceRoleClient();
  const insertRow = {
    cloudflare_id: cfRecord.id,
    filename,
    title: deriveTitle(exifRaw, filename),
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
      "id, cloudflare_id, filename, title, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at",
    )
    .single();

  if (ins.error) {
    // 23505 = duplicate cloudflare_id (idempotency replay or race) —
    // still a useful end-state, fetch the existing row and return it.
    if (ins.error.code === "23505") {
      const existing = await supabase
        .from("image_library")
        .select(
          "id, cloudflare_id, filename, title, caption, alt_text, tags, source, source_ref, width_px, height_px, bytes, deleted_at, created_at",
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
    return internalError("Image uploaded to Cloudflare but failed to save in library.");
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

  // Fix 1 — AI captioning fallback: when EXIF yields no caption, generate
  // one asynchronously via Anthropic vision (fire-and-forget).
  if (!exifCaption && ins.data?.id && file.type.startsWith("image/")) {
    void generateAiCaption(ins.data.id, bytes, file.type);
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
