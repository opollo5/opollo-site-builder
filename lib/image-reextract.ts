import "server-only";

import sharp from "sharp";

import { deliveryUrl } from "@/lib/cloudflare-images";
import { extractExifFields } from "@/lib/exif-extract";
import {
  parseIstockIdFromFilename,
} from "@/lib/image-dimensions";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// Re-extract metadata for an image library row.
//
// Strategy:
//   1. Fetch the original bytes via the Cloudflare Images blob endpoint
//      (requires CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_IMAGES_API_TOKEN).
//      This preserves IPTC/EXIF/XMP — the delivery CDN strips them.
//   2. Run Sharp for reliable dimensions on any format.
//   3. Run extractExifFields for caption, alt_text, tags.
//   4. Derive a human-readable title from EXIF ObjectName/Headline,
//      caption (truncated), or the filename.
//   5. If the blob endpoint fails (missing creds, 403, etc.), fall back
//      to the delivery URL with a Range request for dimensions only.
// ---------------------------------------------------------------------------

export const REEXTRACT_PREFIX_BYTES = 20 * 1024 * 1024; // 20 MB cap for blob

export type ReextractResult = {
  image_id: string;
  dimensions_updated: boolean;
  width_px: number | null;
  height_px: number | null;
  bytes: number | null;
  title: string | null;
  title_updated: boolean;
  caption_updated: boolean;
  istock_id: string | null;
  istock_id_added: boolean;
  exif_metadata_updated: boolean;
  notes: string[];
};

function ts(): string {
  return new Date().toISOString();
}

function notFound(msg = "Image not found."): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: msg,
      retryable: false,
      suggested_action: "Reload the image library; the row may have been archived.",
    },
    timestamp: ts(),
  };
}

function internalError(message: string, details?: Record<string, unknown>): ApiResponse<never> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      details,
      retryable: false,
      suggested_action: "Check Supabase / Cloudflare connectivity and server logs.",
    },
    timestamp: ts(),
  };
}

// ---------------------------------------------------------------------------
// Blob endpoint fetch (preserves EXIF)
// ---------------------------------------------------------------------------

function cfBlobUrl(accountId: string, cfId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(cfId)}/blob`;
}

async function fetchBlobBytes(
  accountId: string,
  apiToken: string,
  cfId: string,
): Promise<{ bytes: Uint8Array; total: number | null } | null> {
  try {
    const res = await fetch(cfBlobUrl(accountId, cfId), {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Range: `bytes=0-${REEXTRACT_PREFIX_BYTES - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) {
      logger.warn("image.reextract.blob_failed", { cf_id: cfId, status: res.status });
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const cr = res.headers.get("content-range");
    let total: number | null = null;
    if (cr) {
      const m = /\/(\d+)$/.exec(cr);
      if (m) total = Number(m[1]);
    } else {
      const cl = res.headers.get("content-length");
      if (cl) total = Number(cl);
    }
    return { bytes: buf, total };
  } catch (err) {
    logger.warn("image.reextract.blob_error", {
      cf_id: cfId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Delivery URL fallback (dimensions only; CDN strips EXIF)
// ---------------------------------------------------------------------------

async function fetchDeliveryHeaderBytes(
  cfId: string,
): Promise<{ bytes: Uint8Array; total: number | null } | null> {
  const url = deliveryUrl(cfId, "public");
  if (!url) return null;
  try {
    const HEADER_SIZE = 64 * 1024;
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${HEADER_SIZE - 1}` },
    });
    if (!res.ok && res.status !== 206) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const cr = res.headers.get("content-range");
    let total: number | null = null;
    if (cr) {
      const m = /\/(\d+)$/.exec(cr);
      if (m) total = Number(m[1]);
    } else {
      const cl = res.headers.get("content-length");
      if (cl) total = Number(cl);
    }
    return { bytes: buf, total };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Title derivation
// ---------------------------------------------------------------------------

function deriveTitle(
  raw: Record<string, unknown> | null,
  filename: string | null,
): string | null {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  if (raw) {
    const title =
      str(raw.ObjectName) ??
      str(raw.Headline) ??
      str(raw.Title) ??
      (str(raw["Caption-Abstract"])?.slice(0, 80) ?? null) ??
      (str(raw.description)?.slice(0, 80) ?? null);
    if (title) return title;
  }

  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, "");
  const m = /^istock[-_](\d+)/i.exec(base);
  if (m) return `iStock Image ${m[1]}`;
  const human = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return human || null;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function reextractImageMetadata(
  imageId: string,
  opts: { updatedBy?: string | null } = {},
): Promise<ApiResponse<ReextractResult>> {
  const supabase = getServiceRoleClient();

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? null;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN ?? null;
  const hasBlobCreds = !!(accountId && apiToken);

  logger.info("image.reextract.start", {
    image_id: imageId,
    has_blob_creds: hasBlobCreds,
    has_delivery_hash: !!process.env.CLOUDFLARE_IMAGES_HASH,
  });

  const imageRes = await supabase
    .from("image_library")
    .select(
      "id, cloudflare_id, filename, title, caption, alt_text, tags, width_px, height_px, bytes, version_lock, deleted_at, source_ref, source",
    )
    .eq("id", imageId)
    .maybeSingle();

  if (imageRes.error) {
    logger.error("image_reextract.reextractImageMetadata.image_fetch_failed", { image_id: imageId, supabase_error: imageRes.error.message });
    return internalError("Failed to load image_library row.", {
      supabase_error: imageRes.error,
    });
  }
  if (!imageRes.data) return notFound();

  const row = imageRes.data as {
    id: string;
    cloudflare_id: string | null;
    filename: string | null;
    title: string | null;
    caption: string | null;
    alt_text: string | null;
    tags: string[];
    width_px: number | null;
    height_px: number | null;
    bytes: number | null;
    version_lock: number;
    deleted_at: string | null;
    source_ref: string | null;
    source: string;
  };

  if (row.deleted_at) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: "Cannot re-extract metadata on an archived image. Restore it first.",
        retryable: false,
        suggested_action: "Restore the image and retry.",
      },
      timestamp: ts(),
    };
  }

  const notes: string[] = [];
  let nextWidth = row.width_px;
  let nextHeight = row.height_px;
  let nextBytes = row.bytes;
  let nextTitle = row.title;
  let nextCaption = row.caption;
  let nextAltText = row.alt_text;
  let nextTags = row.tags ?? [];
  let dimensionsUpdated = false;
  let titleUpdated = false;
  let captionUpdated = false;
  let exifMetadataUpdated = false;

  if (!row.cloudflare_id) {
    notes.push("Image has no cloudflare_id — cannot fetch from Cloudflare.");
  } else {
    // -----------------------------------------------------------------
    // 1. Try the blob endpoint (preserves EXIF).
    // -----------------------------------------------------------------
    let blobFetched = false;
    if (hasBlobCreds) {
      const blob = await fetchBlobBytes(accountId!, apiToken!, row.cloudflare_id);
      if (blob) {
        blobFetched = true;
        const buf = Buffer.from(blob.bytes);

        // Dimensions via Sharp (works for all formats).
        try {
          const meta = await sharp(buf).metadata();
          if (meta.width && meta.height) {
            if (!nextWidth || !nextHeight) {
              nextWidth = meta.width;
              nextHeight = meta.height;
              dimensionsUpdated = true;
            }
          }
        } catch (err) {
          notes.push(`Sharp metadata failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        if (blob.total && !nextBytes) nextBytes = blob.total;

        // EXIF/IPTC/XMP extraction.
        try {
          const exif = await extractExifFields(buf.buffer as ArrayBuffer);
          if (exif) {
            // Write raw EXIF to image_metadata.
            await supabase
              .from("image_metadata")
              .upsert(
                { image_id: row.id, key: "exif_raw", value_jsonb: exif.raw, updated_at: ts() },
                { onConflict: "image_id,key" },
              );
            exifMetadataUpdated = true;

            if (exif.caption && !nextCaption) {
              nextCaption = exif.caption;
              captionUpdated = true;
            }
            if (exif.alt_text && !nextAltText) {
              nextAltText = exif.alt_text;
            }
            if (exif.tags.length > 0 && nextTags.length === 0) {
              nextTags = exif.tags;
            }

            // Derive title from EXIF raw + filename fallback.
            const derived = deriveTitle(exif.raw, row.filename);
            if (derived && !nextTitle) {
              nextTitle = derived;
              titleUpdated = true;
            }
          } else {
            notes.push("No EXIF/IPTC metadata found in image.");
            // Still derive title from filename if not set.
            const derived = deriveTitle(null, row.filename);
            if (derived && !nextTitle) {
              nextTitle = derived;
              titleUpdated = true;
            }
          }
        } catch (err) {
          notes.push(`EXIF extraction failed: ${err instanceof Error ? err.message : String(err)}`);
          logger.warn("image.reextract.exif_failed", {
            image_id: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        notes.push("Blob endpoint returned no data — falling back to delivery URL for dimensions.");
      }
    } else {
      notes.push("CF blob credentials not configured — falling back to delivery URL for dimensions only.");
    }

    // -----------------------------------------------------------------
    // 2. Delivery URL fallback (dimensions only; no EXIF).
    // -----------------------------------------------------------------
    if (!blobFetched && (!nextWidth || !nextHeight)) {
      const delivery = await fetchDeliveryHeaderBytes(row.cloudflare_id);
      if (delivery) {
        try {
          const meta = await sharp(Buffer.from(delivery.bytes)).metadata();
          if (meta.width && meta.height) {
            nextWidth = meta.width;
            nextHeight = meta.height;
            dimensionsUpdated = true;
          }
        } catch {
          // Not fatal — dimensions will remain null.
        }
        if (delivery.total && !nextBytes) nextBytes = delivery.total;
      } else {
        notes.push("Delivery URL fallback also failed.");
      }
    }

    // Title fallback from filename even if no blob.
    if (!nextTitle) {
      const derived = deriveTitle(null, row.filename);
      if (derived) {
        nextTitle = derived;
        titleUpdated = true;
      }
    }
  }

  // -----------------------------------------------------------------
  // iStock id from filename.
  // -----------------------------------------------------------------
  const istockId = parseIstockIdFromFilename(row.filename);
  let istockIdAdded = false;
  if (istockId) {
    const existing = await supabase
      .from("image_metadata")
      .select("id")
      .eq("image_id", row.id)
      .eq("key", "istock_id")
      .maybeSingle();
    if (existing.error) {
      logger.error("image_reextract.reextractImageMetadata.metadata_read_failed", { image_id: imageId, supabase_error: existing.error.message });
      return internalError("Failed to read image_metadata.", {
        supabase_error: existing.error,
      });
    }
    if (!existing.data) {
      const { error: insertErr } = await supabase
        .from("image_metadata")
        .insert({ image_id: row.id, key: "istock_id", value_jsonb: istockId });
      if (insertErr) {
        logger.error("image_reextract.reextractImageMetadata.metadata_insert_failed", { image_id: imageId, supabase_error: insertErr.message });
        return internalError("Failed to insert istock_id metadata.", {
          supabase_error: insertErr,
        });
      }
      istockIdAdded = true;
    } else {
      notes.push("istock_id metadata already present — left as-is.");
    }
  }

  // -----------------------------------------------------------------
  // Write updates to image_library.
  // -----------------------------------------------------------------
  const needsUpdate =
    dimensionsUpdated ||
    titleUpdated ||
    captionUpdated ||
    (nextBytes !== row.bytes && nextBytes !== null);

  if (needsUpdate) {
    const updateRow: Record<string, unknown> = {
      version_lock: row.version_lock + 1,
      updated_at: ts(),
    };
    if (nextWidth !== row.width_px) updateRow.width_px = nextWidth;
    if (nextHeight !== row.height_px) updateRow.height_px = nextHeight;
    if (nextBytes !== row.bytes) updateRow.bytes = nextBytes;
    if (titleUpdated) updateRow.title = nextTitle;
    if (captionUpdated) updateRow.caption = nextCaption;
    if (nextAltText !== row.alt_text) updateRow.alt_text = nextAltText;
    if (nextTags !== row.tags && nextTags.length > 0) updateRow.tags = nextTags;
    if (opts.updatedBy) updateRow.updated_by = opts.updatedBy;

    const { error: updErr } = await supabase
      .from("image_library")
      .update(updateRow)
      .eq("id", row.id)
      .eq("version_lock", row.version_lock);

    if (updErr) {
      logger.error("image_reextract.reextractImageMetadata.image_update_failed", { image_id: imageId, supabase_error: updErr.message });
      return internalError("Failed to update image_library.", {
        supabase_error: updErr,
      });
    }
    logger.info("image.reextract.saved", {
      image_id: row.id,
      dims: `${nextWidth}×${nextHeight}`,
      title_updated: titleUpdated,
      caption_updated: captionUpdated,
    });
  } else {
    notes.push("No changes — row was already complete.");
  }

  return {
    ok: true,
    data: {
      image_id: row.id,
      dimensions_updated: dimensionsUpdated,
      width_px: nextWidth,
      height_px: nextHeight,
      bytes: nextBytes,
      title: nextTitle,
      title_updated: titleUpdated,
      caption_updated: captionUpdated,
      istock_id: istockId,
      istock_id_added: istockIdAdded,
      exif_metadata_updated: exifMetadataUpdated,
      notes,
    },
    timestamp: ts(),
  };
}
