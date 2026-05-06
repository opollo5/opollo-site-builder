/**
 * Backfill captions for image_library rows that have no caption.
 *
 * EXIF-only strategy — no Claude/Anthropic API calls.
 *
 * WHY blob endpoint, not delivery URL:
 *   Cloudflare Images strips IPTC/EXIF/XMP on delivery for optimisation.
 *   The management API /blob endpoint returns the original uploaded file
 *   with metadata intact. iStock images have rich Caption-Abstract,
 *   Headline, and Keywords fields in IPTC, so almost all can be captioned
 *   for free.
 *
 * Required env vars (add to .env.local):
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_IMAGES_API_TOKEN
 *
 * Resume-safe: only processes rows where caption IS NULL or empty.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-image-captions.ts
 */

import { createClient } from "@supabase/supabase-js";
import exifr from "exifr";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? "", 10) || 20;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB — blob endpoint gives original

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfApiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!cfAccountId || !cfApiToken) {
  console.error(
    "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_IMAGES_API_TOKEN\n" +
      "These are needed to fetch original image files (with EXIF intact) from Cloudflare.\n" +
      "Add them to .env.local — they are the same credentials used for uploads.",
  );
  process.exit(1);
}

const svc = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// Cloudflare Images management API blob endpoint — returns the original
// uploaded file with all IPTC/EXIF/XMP metadata intact.
function blobUrl(cloudflareId: string): string {
  const encoded = encodeURIComponent(cloudflareId);
  return `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/images/v1/${encoded}/blob`;
}

// ---------------------------------------------------------------------------
// Image fetch (via management API to preserve EXIF)
// ---------------------------------------------------------------------------

async function fetchOriginalBytes(cloudflareId: string): Promise<Uint8Array | null> {
  const url = blobUrl(cloudflareId);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${cfApiToken}`,
        Range: `bytes=0-${MAX_IMAGE_BYTES - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) {
      console.warn(`  CF blob ${res.status} for ${cloudflareId}`);
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    console.warn(`  fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// EXIF extraction
// ---------------------------------------------------------------------------

type ExifResult = {
  caption: string | null;
  altText: string | null;
  title: string | null;
  tags: string[];
};

function deriveTitleFromExifAndFilename(
  meta: Record<string, unknown> | null,
  filename: string | null,
): string | null {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  if (meta) {
    const t =
      str(meta.ObjectName) ??
      str(meta.Headline) ??
      str(meta.Title) ??
      (str(meta["Caption-Abstract"])?.slice(0, 80) ?? null) ??
      (str(meta.description)?.slice(0, 80) ?? null);
    if (t) return t;
  }
  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, "");
  const m = /^istock[-_](\d+)/i.exec(base);
  if (m) return `iStock Image ${m[1]}`;
  const human = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return human || null;
}

async function extractExifMetadata(bytes: Uint8Array, filename: string | null): Promise<ExifResult> {
  try {
    const meta = await exifr.parse(Buffer.from(bytes), {
      iptc: true,
      exif: true,
      xmp: true,
    });

    if (!meta) return { caption: null, altText: null, title: deriveTitleFromExifAndFilename(null, filename), tags: [] };

    // Guard: exifr can return IPTC fields as objects (IptcRecord) rather than
    // plain strings in some firmware-written JPEGs. Using String() on those
    // produces "[object Object]". Only accept actual string values.
    const str = (v: unknown): string | null => {
      if (typeof v === "string" && v.trim()) return v.trim();
      return null;
    };

    const rawCaption =
      str(meta["Caption-Abstract"]) ??
      str(meta.description) ??
      str(meta.Headline) ??
      null;

    const rawAlt =
      str(meta.Headline) ??
      str(meta.ObjectName) ??
      str(meta.Title) ??
      null;

    const rawTags: unknown =
      (meta.Keywords as unknown) ?? (meta.Subject as unknown) ?? [];
    const tagsArr = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
    const tags = tagsArr
      .filter((t: unknown) => typeof t === "string")
      .map((t: unknown) => (t as string).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);

    const caption = rawCaption ? rawCaption.slice(0, 150) || null : null;
    const altText = rawAlt ? rawAlt.slice(0, 100) || null : null;
    const title = deriveTitleFromExifAndFilename(meta, filename);

    return { caption, altText, title, tags };
  } catch {
    return { caption: null, altText: null, title: deriveTitleFromExifAndFilename(null, filename), tags: [] };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Backfill mode: LIVE — EXIF only via Cloudflare blob endpoint (no Claude API calls)\n");

  const { count } = await svc
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("caption.is.null,caption.eq.,caption.eq.[object Object],title.is.null");

  const total = count ?? 0;
  console.log(`Images needing captions or titles: ${total}\n`);

  let processed = 0;
  let exifCount = 0;
  let noData = 0;
  let errors = 0;
  let offset = 0;

  while (true) {
    const { data: rows, error } = await svc
      .from("image_library")
      .select("id, cloudflare_id, filename, caption, title, tags")
      .is("deleted_at", null)
      .or("caption.is.null,caption.eq.,caption.eq.[object Object],title.is.null")
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`DB query error: ${error.message}`);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      processed++;

      // Resume-safe: skip rows that already have both caption and title.
      // "[object Object]" is treated as absent — it's a bug artefact, not real data.
      const existingCaption = (row.caption as string | null)?.trim() ?? "";
      const captionOk = existingCaption.length > 0 && existingCaption !== "[object Object]";
      const existingTitle = (row.title as string | null)?.trim() ?? "";
      const titleOk = existingTitle.length > 0;
      if (captionOk && titleOk) {
        noData++;
        continue;
      }

      const cloudflareId = row.cloudflare_id as string | null;
      if (!cloudflareId) {
        console.log(`[${processed}/${total}] ${row.id} — no cloudflare_id, skipping`);
        noData++;
        continue;
      }

      const bytes = await fetchOriginalBytes(cloudflareId);
      if (!bytes) {
        errors++;
        continue;
      }

      const exif = await extractExifMetadata(bytes, row.filename as string | null);
      const hasData = Boolean(exif.caption || exif.altText || exif.title);

      if (!hasData) {
        console.log(
          `[${processed}/${total}] ${row.filename ?? row.id} — No EXIF data — skipping`,
        );
        noData++;
        continue;
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (exif.caption && !captionOk) patch.caption = exif.caption;
      if (exif.altText) patch.alt_text = exif.altText;
      if (exif.title && !titleOk) patch.title = exif.title;
      if (exif.tags.length > 0) {
        const existing = Array.isArray(row.tags) ? (row.tags as string[]) : [];
        patch.tags = Array.from(new Set([...existing, ...exif.tags]));
      }

      if (Object.keys(patch).length === 1) {
        // Only updated_at — nothing new to write.
        noData++;
        continue;
      }

      const { error: updateError } = await svc
        .from("image_library")
        .update(patch)
        .eq("id", row.id);

      if (updateError) {
        console.error(`[${processed}/${total}] ${row.id} — DB error: ${updateError.message}`);
        errors++;
      } else {
        console.log(
          `[${processed}/${total}] ${row.filename ?? row.id} — EXIF ✓  title="${exif.title?.slice(0, 40)}" caption="${exif.caption?.slice(0, 60)}"`,
        );
        exifCount++;
      }

      if (processed % 50 === 0) {
        console.log(
          `  --- Progress ${processed} of ${total} — EXIF: ${exifCount} | No data: ${noData} | Errors: ${errors}`,
        );
      }
    }

    offset += BATCH_SIZE;
    if (!rows || rows.length < BATCH_SIZE) break;
  }

  console.log(`\n--- Done ---`);
  console.log(`Processed:  ${processed}`);
  console.log(`EXIF saves: ${exifCount}`);
  console.log(`No data:    ${noData}`);
  console.log(`Errors:     ${errors}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
