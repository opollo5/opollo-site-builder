import { deliveryUrl } from "@/lib/cloudflare-images";
import {
  parseIstockIdFromFilename,
  readImageDimensions,
} from "@/lib/image-dimensions";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// Re-extract metadata for an image library row.
//
// Bulk-uploaded images (scripts/import-bulk-uploaded-images.ts) land with
// width_px / height_px / iStock provenance unset. This helper reads the
// public Cloudflare delivery URL header bytes, derives dimensions, parses
// any iStock asset id from the original filename, and writes both back:
//
//   - image_library.{width_px, height_px, bytes} when dimensions land.
//   - image_metadata (key='istock_id') when the filename matches.
//
// Idempotent: re-running on a row that already has dimensions and the
// iStock id is a no-op. The endpoint that wraps this returns a summary of
// what changed so the UI can render an actionable toast.
// ---------------------------------------------------------------------------

export const REEXTRACT_PREFIX_BYTES = 64 * 1024;

export type ReextractResult = {
  image_id: string;
  dimensions_updated: boolean;
  width_px: number | null;
  height_px: number | null;
  bytes: number | null;
  istock_id: string | null;
  istock_id_added: boolean;
  notes: string[];
};

function now(): string {
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
    timestamp: now(),
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
    timestamp: now(),
  };
}

async function fetchHeaderBytes(url: string): Promise<{ bytes: Uint8Array; total: number | null }> {
  // Use a Range request so Cloudflare doesn't have to stream the whole
  // file just for dimension extraction. Cloudflare delivery URLs honour
  // Range; if a hash misconfig drops it, we fall back to a regular GET
  // and slice the buffer.
  const res = await fetch(url, {
    headers: { Range: `bytes=0-${REEXTRACT_PREFIX_BYTES - 1}` },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Cloudflare delivery URL returned HTTP ${res.status}.`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const totalHeader = res.headers.get("content-range");
  let total: number | null = null;
  if (totalHeader) {
    const m = /\/(\d+)$/.exec(totalHeader);
    if (m) total = Number(m[1]);
  } else {
    const len = res.headers.get("content-length");
    if (len) total = Number(len);
  }
  return { bytes: buf, total };
}

export async function reextractImageMetadata(
  imageId: string,
  opts: { updatedBy?: string | null } = {},
): Promise<ApiResponse<ReextractResult>> {
  const supabase = getServiceRoleClient();

  const imageRes = await supabase
    .from("image_library")
    .select(
      "id, cloudflare_id, filename, width_px, height_px, bytes, version_lock, deleted_at, source_ref, source",
    )
    .eq("id", imageId)
    .maybeSingle();

  if (imageRes.error) {
    return internalError("Failed to load image_library row.", {
      supabase_error: imageRes.error,
    });
  }
  if (!imageRes.data) return notFound();

  const row = imageRes.data as {
    id: string;
    cloudflare_id: string | null;
    filename: string | null;
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
      timestamp: now(),
    };
  }

  const notes: string[] = [];
  let nextWidth = row.width_px;
  let nextHeight = row.height_px;
  let nextBytes = row.bytes;
  let dimensionsUpdated = false;

  if (row.cloudflare_id) {
    if (!row.width_px || !row.height_px || !row.bytes) {
      const url = deliveryUrl(row.cloudflare_id, "public");
      if (!url) {
        notes.push("CLOUDFLARE_IMAGES_HASH unset; skipped dimension probe.");
      } else {
        try {
          const { bytes, total } = await fetchHeaderBytes(url);
          const dims = readImageDimensions(bytes);
          if (dims) {
            nextWidth = nextWidth ?? dims.width;
            nextHeight = nextHeight ?? dims.height;
            dimensionsUpdated = true;
          } else {
            notes.push("Could not parse dimensions from image header bytes.");
          }
          if (!nextBytes && typeof total === "number" && total > 0) {
            nextBytes = total;
          }
        } catch (err) {
          notes.push(
            `Dimension probe failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else {
      notes.push("Dimensions already populated — left as-is.");
    }
  } else {
    notes.push("Image has no cloudflare_id; cannot probe.");
  }

  const istockId = parseIstockIdFromFilename(row.filename);
  let istockIdAdded = false;
  if (istockId) {
    const existing = await supabase
      .from("image_metadata")
      .select("id, value_jsonb")
      .eq("image_id", row.id)
      .eq("key", "istock_id")
      .maybeSingle();
    if (existing.error) {
      return internalError("Failed to read image_metadata.", {
        supabase_error: existing.error,
      });
    }
    if (!existing.data) {
      const insertRes = await supabase
        .from("image_metadata")
        .insert({
          image_id: row.id,
          key: "istock_id",
          value_jsonb: istockId,
        });
      if (insertRes.error) {
        return internalError("Failed to insert image_metadata.", {
          supabase_error: insertRes.error,
        });
      }
      istockIdAdded = true;
    } else {
      notes.push("istock_id metadata already present — left as-is.");
    }
  }

  if (
    dimensionsUpdated ||
    (nextBytes !== row.bytes && nextBytes !== null)
  ) {
    const updateRow: Record<string, unknown> = {
      version_lock: row.version_lock + 1,
      updated_at: now(),
    };
    if (nextWidth !== row.width_px) updateRow.width_px = nextWidth;
    if (nextHeight !== row.height_px) updateRow.height_px = nextHeight;
    if (nextBytes !== row.bytes) updateRow.bytes = nextBytes;
    if (opts.updatedBy) updateRow.updated_by = opts.updatedBy;

    const updRes = await supabase
      .from("image_library")
      .update(updateRow)
      .eq("id", row.id)
      .eq("version_lock", row.version_lock);

    if (updRes.error) {
      return internalError("Failed to update image_library.", {
        supabase_error: updRes.error,
      });
    }
  }

  return {
    ok: true,
    data: {
      image_id: row.id,
      dimensions_updated: dimensionsUpdated,
      width_px: nextWidth,
      height_px: nextHeight,
      bytes: nextBytes,
      istock_id: istockId,
      istock_id_added: istockIdAdded,
      notes,
    },
    timestamp: now(),
  };
}
