/**
 * Comprehensive metadata extraction for all image_library rows.
 *
 * What this extracts per image (via Cloudflare blob endpoint → original bytes,
 * EXIF intact — delivery URLs strip IPTC/EXIF):
 *
 *   image_library columns:
 *     caption, alt_text, tags   — from IPTC/XMP via exifr
 *     width_px, height_px       — from Sharp metadata()
 *     bytes                     — from Content-Length / actual buffer size
 *
 *   image_metadata rows (key/value, UPSERT):
 *     exif_raw              — full raw exifr output
 *     dominant_colors       — {primary: "#rrggbb"} from Sharp stats()
 *     camera                — {make, model, date_taken} from EXIF Make/Model/DateTimeOriginal
 *     gps                   — {lat, lng} from EXIF GPS fields (iStock stock photos rarely have GPS)
 *     istock_id             — numeric iStock asset id parsed from filename
 *     metadata_extracted_at — ISO timestamp sentinel (idempotency marker)
 *
 * Idempotency:
 *   Rows that already have key='metadata_extracted_at' are skipped unless --force.
 *   Per-field guards: image_library fields are only written when currently NULL/empty.
 *   image_metadata rows use UPSERT (on conflict update) so re-runs are safe.
 *
 * Required env vars:
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_IMAGES_API_TOKEN
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/extract-image-metadata.ts
 *   npx tsx scripts/extract-image-metadata.ts --force           # re-extract everything
 *   npx tsx scripts/extract-image-metadata.ts --limit 50        # process first N images
 *   npx tsx scripts/extract-image-metadata.ts --batch-size 5    # smaller batches (default 10)
 *   npx tsx scripts/extract-image-metadata.ts --dry-run         # parse but don't write to DB
 */

import { createClient } from "@supabase/supabase-js";
import exifr from "exifr";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const DRY_RUN = argv.includes("--dry-run");
const LIMIT = (() => {
  const i = argv.indexOf("--limit");
  return i !== -1 ? parseInt(argv[i + 1], 10) : null;
})();
const BATCH_SIZE = (() => {
  const i = argv.indexOf("--batch-size");
  return i !== -1 ? parseInt(argv[i + 1], 10) : 10;
})();

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfApiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY\n" +
      "Add them to .env.local: set -a && source .env.local && set +a",
  );
  process.exit(1);
}
if (!cfAccountId || !cfApiToken) {
  console.error(
    "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_IMAGES_API_TOKEN\n" +
      "Needed to fetch original image bytes from Cloudflare (with EXIF intact).\n" +
      "The delivery URL strips IPTC/EXIF; only the blob endpoint preserves it.\n" +
      "Add both to .env.local — same credentials used for uploads.",
  );
  process.exit(1);
}

const svc = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Cloudflare blob endpoint
// ---------------------------------------------------------------------------

function blobUrl(cloudflareId: string): string {
  const encoded = encodeURIComponent(cloudflareId);
  return `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/images/v1/${encoded}/blob`;
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB ceiling

async function fetchOriginalBytes(
  cloudflareId: string,
): Promise<{ bytes: Uint8Array; totalBytes: number | null } | null> {
  const url = blobUrl(cloudflareId);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${cfApiToken}`,
        Range: `bytes=0-${MAX_IMAGE_BYTES - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) {
      console.warn(`  CF blob HTTP ${res.status} for ${cloudflareId}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Try to get the true file size from Content-Range header.
    const cr = res.headers.get("content-range"); // "bytes 0-N/TOTAL"
    let total: number | null = null;
    if (cr) {
      const m = /\/(\d+)$/.exec(cr);
      if (m) total = Number(m[1]);
    }
    if (total === null) {
      const cl = res.headers.get("content-length");
      if (cl) total = Number(cl);
    }
    return { bytes, totalBytes: total };
  } catch (err) {
    console.warn(
      `  fetch error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// EXIF / IPTC extraction (safe — no [object Object] bug)
// ---------------------------------------------------------------------------

type ExtractedExif = {
  caption: string | null;
  alt_text: string | null;
  tags: string[];
  cameraMake: string | null;
  cameraModel: string | null;
  dateTaken: string | null; // ISO string
  gpsLat: number | null;
  gpsLng: number | null;
  raw: Record<string, unknown>;
};

const TAG_LIMIT = 12;

function safeStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  // exifr can return some IPTC fields as objects (IptcRecord) rather than plain
  // strings in certain firmware-written JPEGs. Guard against [object Object].
  return null;
}

function toTagArray(v: unknown): string[] {
  if (typeof v === "string" && v.trim())
    return v
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  if (Array.isArray(v))
    return (v as unknown[])
      .filter((s) => typeof s === "string")
      .map((s) => (s as string).trim())
      .filter(Boolean);
  return [];
}

async function extractExif(bytes: Uint8Array): Promise<ExtractedExif | null> {
  let raw: Record<string, unknown> | undefined;
  try {
    raw = (await exifr.parse(Buffer.from(bytes), {
      tiff: true,
      xmp: true,
      iptc: true,
      icc: false,
      reviveValues: true,
    })) as Record<string, unknown> | undefined;
  } catch (err) {
    console.warn(
      `  exifr error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  if (!raw) return null;

  const caption =
    safeStr(raw["Caption-Abstract"]) ??
    safeStr(raw.description) ??
    safeStr(raw.Headline) ??
    null;

  const alt_text =
    safeStr(raw.Headline) ??
    safeStr(raw.ObjectName) ??
    safeStr(raw.Title) ??
    null;

  const kwTags = toTagArray(raw.Keywords);
  const subTags = toTagArray(raw.Subject);
  const tags = (kwTags.length >= subTags.length ? kwTags : subTags).slice(
    0,
    TAG_LIMIT,
  );

  const cameraMake = safeStr(raw.Make);
  const cameraModel = safeStr(raw.Model);

  let dateTaken: string | null = null;
  const dto = raw.DateTimeOriginal ?? raw.CreateDate;
  if (dto instanceof Date) {
    dateTaken = dto.toISOString();
  } else if (typeof dto === "string" && dto.trim()) {
    // exifr sometimes returns "YYYY:MM:DD HH:MM:SS" format
    const normalised = dto.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
    const d = new Date(normalised);
    if (!isNaN(d.getTime())) dateTaken = d.toISOString();
  }

  let gpsLat: number | null = null;
  let gpsLng: number | null = null;
  // When reviveValues=true, exifr converts GPS to decimal degrees directly.
  if (typeof raw.latitude === "number" && typeof raw.longitude === "number") {
    gpsLat = raw.latitude;
    gpsLng = raw.longitude;
  } else if (
    typeof raw.GPSLatitude === "number" &&
    typeof raw.GPSLongitude === "number"
  ) {
    gpsLat = raw.GPSLatitude;
    gpsLng = raw.GPSLongitude;
  }

  return { caption, alt_text, tags, cameraMake, cameraModel, dateTaken, gpsLat, gpsLng, raw };
}

// ---------------------------------------------------------------------------
// Sharp — dimensions + dominant colour
// ---------------------------------------------------------------------------

type SharpExtract = {
  width: number | null;
  height: number | null;
  dominantHex: string | null;
};

function toHex(n: number): string {
  return Math.round(n).toString(16).padStart(2, "0");
}

async function extractSharp(bytes: Uint8Array): Promise<SharpExtract> {
  try {
    const img = sharp(Buffer.from(bytes));
    const [meta, stats] = await Promise.all([img.metadata(), img.stats()]);
    const width = meta.width ?? null;
    const height = meta.height ?? null;
    let dominantHex: string | null = null;
    if (stats.dominant) {
      const { r, g, b } = stats.dominant;
      dominantHex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
    return { width, height, dominantHex };
  } catch (err) {
    console.warn(
      `  sharp error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { width: null, height: null, dominantHex: null };
  }
}

// ---------------------------------------------------------------------------
// iStock id from filename
// ---------------------------------------------------------------------------

const ISTOCK_RE = /iStock[-_](\d{6,})/i;

function parseIstockId(filename: string | null): string | null {
  if (!filename) return null;
  const m = ISTOCK_RE.exec(filename);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// image_metadata upsert helper
// ---------------------------------------------------------------------------

async function upsertMeta(
  imageId: string,
  key: string,
  value: unknown,
): Promise<void> {
  if (DRY_RUN) return;
  const now = new Date().toISOString();
  const { error } = await svc.from("image_metadata").upsert(
    {
      image_id: imageId,
      key,
      value_jsonb: value,
      updated_at: now,
    },
    { onConflict: "image_id,key" },
  );
  if (error) {
    console.warn(`  metadata upsert failed (${key}): ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main processing loop
// ---------------------------------------------------------------------------

type ImageRow = {
  id: string;
  cloudflare_id: string | null;
  filename: string | null;
  caption: string | null;
  alt_text: string | null;
  tags: string[] | null;
  width_px: number | null;
  height_px: number | null;
  bytes: bigint | null;
  version_lock: number;
};

async function processImage(row: ImageRow, index: number, total: number): Promise<void> {
  const label = `[${index}/${total}] ${row.filename ?? row.id}`;

  if (!row.cloudflare_id) {
    console.log(`${label} — no cloudflare_id, skipping`);
    return;
  }

  const fetched = await fetchOriginalBytes(row.cloudflare_id);
  if (!fetched) {
    console.log(`${label} — blob fetch failed`);
    return;
  }
  const { bytes, totalBytes } = fetched;

  // Run EXIF and Sharp extraction in parallel.
  const [exifResult, sharpResult] = await Promise.all([
    extractExif(bytes),
    extractSharp(bytes),
  ]);

  const istockId = parseIstockId(row.filename);
  const now = new Date().toISOString();

  // -----------------------------------------------------------------------
  // Build image_library patch (only overwrite NULL / empty values).
  // -----------------------------------------------------------------------
  const patch: Record<string, unknown> = { updated_at: now };
  let patched = false;

  const setCaption = exifResult?.caption;
  if (setCaption && (!row.caption || row.caption === "[object Object]" || FORCE)) {
    patch.caption = setCaption;
    patched = true;
  }
  const setAlt = exifResult?.alt_text;
  if (setAlt && (!row.alt_text || FORCE)) {
    patch.alt_text = setAlt;
    patched = true;
  }
  if ((exifResult?.tags ?? []).length > 0 && (!(row.tags?.length) || FORCE)) {
    patch.tags = exifResult!.tags;
    patched = true;
  }
  if (sharpResult.width && (!row.width_px || FORCE)) {
    patch.width_px = sharpResult.width;
    patched = true;
  }
  if (sharpResult.height && (!row.height_px || FORCE)) {
    patch.height_px = sharpResult.height;
    patched = true;
  }
  const fileBytes = totalBytes ?? bytes.length;
  if (fileBytes > 0 && (!row.bytes || FORCE)) {
    patch.bytes = fileBytes;
    patched = true;
  }

  if (patched && !DRY_RUN) {
    const { error } = await svc
      .from("image_library")
      .update(patch)
      .eq("id", row.id);
    if (error) {
      console.warn(`${label} — DB update failed: ${error.message}`);
    }
  }

  // -----------------------------------------------------------------------
  // image_metadata upserts.
  // -----------------------------------------------------------------------
  if (exifResult) {
    await upsertMeta(row.id, "exif_raw", exifResult.raw);

    const camera: Record<string, unknown> = {};
    if (exifResult.cameraMake) camera.make = exifResult.cameraMake;
    if (exifResult.cameraModel) camera.model = exifResult.cameraModel;
    if (exifResult.dateTaken) camera.date_taken = exifResult.dateTaken;
    if (Object.keys(camera).length > 0) {
      await upsertMeta(row.id, "camera", camera);
    }

    if (exifResult.gpsLat !== null && exifResult.gpsLng !== null) {
      await upsertMeta(row.id, "gps", {
        lat: exifResult.gpsLat,
        lng: exifResult.gpsLng,
      });
    }
  }

  if (sharpResult.dominantHex) {
    await upsertMeta(row.id, "dominant_colors", {
      primary: sharpResult.dominantHex,
    });
  }

  if (istockId) {
    await upsertMeta(row.id, "istock_id", istockId);
  }

  // Sentinel: marks this row as fully processed.
  await upsertMeta(row.id, "metadata_extracted_at", now);

  const dims =
    sharpResult.width && sharpResult.height
      ? `${sharpResult.width}×${sharpResult.height}`
      : "no dims";
  const cap = patch.caption
    ? `caption="${String(patch.caption).slice(0, 50)}"`
    : exifResult?.caption
      ? `caption(skip — already set)`
      : "no caption";
  const colour = sharpResult.dominantHex ?? "no colour";
  console.log(`${label} — ${dims} | ${colour} | ${cap}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    [
      `extract-image-metadata — ${new Date().toISOString()}`,
      `  mode:       ${DRY_RUN ? "DRY RUN (no DB writes)" : FORCE ? "FORCE (overwrite existing)" : "LIVE (fill gaps only)"}`,
      `  limit:      ${LIMIT ?? "all"}`,
      `  batch-size: ${BATCH_SIZE}`,
    ].join("\n"),
  );
  console.log("");

  // Resolve list of image ids to process.
  // When not --force, skip rows that already have the sentinel.
  let idsToProcess: string[] = [];

  if (FORCE) {
    // Process all non-deleted rows.
    const { data, error } = await svc
      .from("image_library")
      .select("id")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(LIMIT ?? 100_000);
    if (error) {
      console.error(`Failed to list images: ${error.message}`);
      process.exit(1);
    }
    idsToProcess = (data ?? []).map((r) => r.id as string);
  } else {
    // Exclude rows that already have the sentinel.
    const { data: doneRows, error: doneErr } = await svc
      .from("image_metadata")
      .select("image_id")
      .eq("key", "metadata_extracted_at")
      .limit(100_000);
    if (doneErr) {
      console.error(`Failed to query sentinel rows: ${doneErr.message}`);
      process.exit(1);
    }
    const doneIds = new Set((doneRows ?? []).map((r) => r.image_id as string));

    const { data: allRows, error: allErr } = await svc
      .from("image_library")
      .select("id")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(LIMIT ?? 100_000);
    if (allErr) {
      console.error(`Failed to list images: ${allErr.message}`);
      process.exit(1);
    }
    idsToProcess = (allRows ?? [])
      .map((r) => r.id as string)
      .filter((id) => !doneIds.has(id));
  }

  if (LIMIT && idsToProcess.length > LIMIT) {
    idsToProcess = idsToProcess.slice(0, LIMIT);
  }

  const total = idsToProcess.length;
  console.log(`Images to process: ${total}\n`);

  if (total === 0) {
    console.log("Nothing to do — all images already extracted. Use --force to re-run.");
    return;
  }

  let ok = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches to avoid opening too many concurrent fetch connections.
  for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
    const batchIds = idsToProcess.slice(batchStart, batchStart + BATCH_SIZE);

    const { data: rows, error: rowErr } = await svc
      .from("image_library")
      .select(
        "id, cloudflare_id, filename, caption, alt_text, tags, width_px, height_px, bytes, version_lock",
      )
      .in("id", batchIds);

    if (rowErr) {
      console.error(`Batch fetch error: ${rowErr.message}`);
      errors += batchIds.length;
      continue;
    }

    for (const row of rows ?? []) {
      const idx = batchStart + (rows ?? []).indexOf(row) + 1;
      try {
        await processImage(row as ImageRow, idx, total);
        ok++;
      } catch (err) {
        console.error(
          `[${idx}/${total}] ${(row as ImageRow).filename ?? row.id} — unhandled error: ${err instanceof Error ? err.message : String(err)}`,
        );
        errors++;
      }
    }

    if (batchStart + BATCH_SIZE < total) {
      // Small courtesy pause between batches to avoid hammering the CF API.
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(
    [
      "",
      "--- Done ---",
      `Processed: ${ok}`,
      `Skipped:   ${skipped}`,
      `Errors:    ${errors}`,
      `Total:     ${total}`,
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
