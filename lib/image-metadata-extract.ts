import "server-only";

import sharp from "sharp";
import exifr from "exifr";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtractionBatchResult = {
  processed: number;
  saved: number;
  noData: number;
  errors: number;
  remaining: number | null;
  done: boolean;
};

export type ExtractionProgress = {
  total: number;
  done: number;
  remaining: number;
  pct: number;
  cfCredsPresent: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CF_BLOB_BASE =
  "https://api.cloudflare.com/client/v4/accounts";

function blobUrl(accountId: string, cfId: string): string {
  return `${CF_BLOB_BASE}/${accountId}/images/v1/${encodeURIComponent(cfId)}/blob`;
}

// Only accept plain strings — IPTC record objects stringify to "[object Object]".
function safeStr(v: unknown, maxLen: number): string | null {
  if (typeof v === "string" && v.trim()) return v.trim().slice(0, maxLen) || null;
  return null;
}

async function fetchImageBytes(
  accountId: string,
  apiToken: string,
  cfId: string,
): Promise<Uint8Array | null> {
  const MAX = 20 * 1024 * 1024;
  try {
    const res = await fetch(blobUrl(accountId, cfId), {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Range: `bytes=0-${MAX - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) {
      logger.warn("extract.blob_fetch_failed", { cf_id: cfId, status: res.status });
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    logger.warn("extract.blob_fetch_error", {
      cf_id: cfId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

type ImageMeta = {
  width: number | null;
  height: number | null;
  dominantR: number | null;
  dominantG: number | null;
  dominantB: number | null;
  title: string | null;
  caption: string | null;
  altText: string | null;
  tags: string[];
  exifRaw: Record<string, unknown> | null;
};

async function extractMetadata(bytes: Uint8Array): Promise<ImageMeta> {
  const buf = Buffer.from(bytes);

  // Sharp: dimensions + dominant colour
  let width: number | null = null;
  let height: number | null = null;
  let dominantR: number | null = null;
  let dominantG: number | null = null;
  let dominantB: number | null = null;

  try {
    const img = sharp(buf);
    const [meta, stats] = await Promise.all([img.metadata(), img.stats()]);
    width = meta.width ?? null;
    height = meta.height ?? null;
    dominantR = Math.round(stats.dominant.r);
    dominantG = Math.round(stats.dominant.g);
    dominantB = Math.round(stats.dominant.b);
  } catch {
    // non-fatal — carry on to EXIF
  }

  // exifr: IPTC/XMP/EXIF
  let title: string | null = null;
  let caption: string | null = null;
  let altText: string | null = null;
  let tags: string[] = [];
  let exifRaw: Record<string, unknown> | null = null;

  try {
    const parsed = await exifr.parse(buf, {
      iptc: true,
      exif: true,
      xmp: true,
      reviveValues: true,
    });

    if (parsed) {
      exifRaw = parsed as Record<string, unknown>;

      title =
        safeStr(parsed.ObjectName, 100) ??
        safeStr(parsed.Headline, 100) ??
        safeStr(parsed.Title, 100);

      caption =
        safeStr(parsed["Caption-Abstract"], 150) ??
        safeStr(parsed.description, 150) ??
        safeStr(parsed.Headline, 150);

      altText =
        safeStr(parsed.Headline, 100) ??
        safeStr(parsed.ObjectName, 100) ??
        safeStr(parsed.Title, 100);

      const rawKw: unknown =
        (parsed.Keywords as unknown) ?? (parsed.Subject as unknown) ?? [];
      const kwArr = Array.isArray(rawKw) ? rawKw : rawKw ? [rawKw] : [];
      tags = kwArr
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
    }
  } catch {
    // non-fatal
  }

  return { width, height, dominantR, dominantG, dominantB, title, caption, altText, tags, exifRaw };
}

// ---------------------------------------------------------------------------
// Core batch runner
// ---------------------------------------------------------------------------

export async function runExtractionBatch(opts: {
  accountId: string;
  apiToken: string;
  batchSize?: number;
}): Promise<ExtractionBatchResult> {
  const { accountId, apiToken, batchSize = 10 } = opts;
  const svc = getServiceRoleClient();

  logger.info("extract.batch_start", {
    batch_size: batchSize,
    has_account_id: !!accountId,
    has_api_token: !!apiToken,
    has_delivery_hash: !!process.env.CLOUDFLARE_IMAGES_HASH,
  });
  const now = new Date().toISOString();

  // Primary idempotency: only rows that don't have dimensions yet.
  const { data: rows, error: fetchErr } = await svc
    .from("image_library")
    .select("id, cloudflare_id, filename, tags")
    .is("deleted_at", null)
    .is("width_px", null)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (fetchErr) {
    logger.error("extract.db_query_failed", { error: fetchErr.message });
    throw new Error(fetchErr.message);
  }

  const batch = rows ?? [];
  const batchIds = batch.map((r) => r.id as string);

  // Secondary idempotency: skip rows already processed this batch cycle
  // (covers images where Sharp couldn't extract dimensions).
  let doneIds = new Set<string>();
  if (batchIds.length > 0) {
    const { data: sentinels } = await svc
      .from("image_metadata")
      .select("image_id")
      .in("image_id", batchIds)
      .eq("key", "metadata_extracted_at");
    doneIds = new Set((sentinels ?? []).map((s) => s.image_id as string));
  }

  let saved = 0;
  let noData = 0;
  let errors = 0;

  for (const row of batch) {
    const imageId = row.id as string;
    if (doneIds.has(imageId)) {
      noData++;
      continue;
    }

    const cfId = row.cloudflare_id as string | null;
    if (!cfId) {
      noData++;
      continue;
    }

    const bytes = await fetchImageBytes(accountId, apiToken, cfId);
    if (!bytes) {
      errors++;
      continue;
    }

    const meta = await extractMetadata(bytes);

    // Write dimensions + text fields to image_library.
    const patch: Record<string, unknown> = { updated_at: now };
    if (meta.width !== null) patch.width_px = meta.width;
    if (meta.height !== null) patch.height_px = meta.height;
    if (meta.title) patch.title = meta.title;
    if (meta.caption) patch.caption = meta.caption;
    if (meta.altText) patch.alt_text = meta.altText;
    if (meta.tags.length > 0) {
      const existing = Array.isArray(row.tags) ? (row.tags as string[]) : [];
      patch.tags = Array.from(new Set([...existing, ...meta.tags]));
    }

    const { error: libErr } = await svc
      .from("image_library")
      .update(patch)
      .eq("id", imageId);

    if (libErr) {
      logger.error("extract.library_update_failed", {
        image_id: imageId,
        error: libErr.message,
      });
      errors++;
      continue;
    }

    // Write sidecar metadata rows.
    // Only write the sentinel when something was actually extracted — writing
    // it unconditionally would permanently skip images where Sharp / exifr
    // both yield nothing (sentinel found next run → skipped forever despite
    // width_px still being null).
    const didExtractData =
      meta.width !== null ||
      meta.caption !== null ||
      meta.title !== null ||
      meta.altText !== null ||
      meta.tags.length > 0;

    type MetaRow = {
      image_id: string;
      key: string;
      value_jsonb: unknown;
      updated_at: string;
    };
    const sidecar: MetaRow[] = didExtractData
      ? [
          {
            image_id: imageId,
            key: "metadata_extracted_at",
            value_jsonb: now,
            updated_at: now,
          },
        ]
      : [];

    if (meta.dominantR !== null) {
      sidecar.push({
        image_id: imageId,
        key: "dominant_color",
        value_jsonb: { r: meta.dominantR, g: meta.dominantG, b: meta.dominantB },
        updated_at: now,
      });
    }

    if (meta.exifRaw) {
      // Store only a safe subset — skip binary blobs, unknown objects.
      const safeKeys = [
        "Make",
        "Model",
        "DateTimeOriginal",
        "latitude",
        "longitude",
        "Copyright",
        "Credit",
        "Source",
        "Country",
        "City",
      ];
      const subset: Record<string, unknown> = {};
      for (const k of safeKeys) {
        if (k in meta.exifRaw) subset[k] = meta.exifRaw[k];
      }
      if (Object.keys(subset).length > 0) {
        sidecar.push({
          image_id: imageId,
          key: "exif_summary",
          value_jsonb: subset,
          updated_at: now,
        });
      }
    }

    const { error: sidecarErr } = await svc
      .from("image_metadata")
      .upsert(sidecar, { onConflict: "image_id,key" });

    if (sidecarErr) {
      logger.warn("extract.sidecar_upsert_failed", {
        image_id: imageId,
        error: sidecarErr.message,
      });
    }

    logger.info("extract.image_saved", {
      image_id: imageId,
      filename: row.filename,
      width: meta.width,
      height: meta.height,
      caption: meta.caption?.slice(0, 60) ?? null,
    });
    saved++;
  }

  // Title-only backfill: any image with no title, regardless of whether
  // dimensions have been extracted yet. Covers (a) images processed before
  // migration 0099 added the title column, (b) bulk-imported images that
  // haven't gone through the Cloudflare EXIF extraction yet.
  // Derive from filename alone — no Cloudflare API call needed.
  const { data: titleRows } = await svc
    .from("image_library")
    .select("id, filename")
    .is("deleted_at", null)
    .is("title", null)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  for (const row of titleRows ?? []) {
    const filename = row.filename as string | null;
    if (!filename) continue;
    const base = filename.replace(/\.[^.]+$/, "");
    const m = /^istock[-_](\d+)/i.exec(base);
    const derived = m
      ? `iStock Image ${m[1]}`
      : base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || null;
    if (!derived) continue;
    await svc
      .from("image_library")
      .update({ title: derived, updated_at: now })
      .eq("id", row.id as string)
      .is("title", null);
  }

  // Count remaining images still needing extraction.
  const { count: remaining } = await svc
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("width_px", null);

  logger.info("extract.batch_complete", {
    processed: batch.length,
    saved,
    no_data: noData,
    errors,
    remaining: remaining ?? "?",
  });

  return {
    processed: batch.length,
    saved,
    noData,
    errors,
    remaining: remaining ?? null,
    done: (remaining ?? 1) === 0,
  };
}

// ---------------------------------------------------------------------------
// Progress query (for the admin UI)
// ---------------------------------------------------------------------------

export async function getExtractionProgress(): Promise<ExtractionProgress> {
  const svc = getServiceRoleClient();

  const [totalRes, remainingRes] = await Promise.all([
    svc
      .from("image_library")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null),
    svc
      .from("image_library")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .is("width_px", null),
  ]);

  const total = totalRes.count ?? 0;
  const remaining = remainingRes.count ?? 0;
  const done = total - remaining;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    total,
    done,
    remaining,
    pct,
    cfCredsPresent: !!(
      process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_IMAGES_API_TOKEN
    ),
  };
}
