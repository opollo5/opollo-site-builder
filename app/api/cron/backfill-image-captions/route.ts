import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/crypto-compare";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import exifr from "exifr";

export const dynamic = "force-dynamic";
export const maxDuration = 299;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

// ---------------------------------------------------------------------------
// Cloudflare Images blob endpoint — returns original uploaded file
// with IPTC/EXIF/XMP intact (delivery CDN strips metadata).
// ---------------------------------------------------------------------------

const BATCH_SIZE = 50;
const MAX_BYTES = 20 * 1024 * 1024;

function blobUrl(accountId: string, cloudflareId: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1/${encodeURIComponent(cloudflareId)}/blob`;
}

async function fetchOriginalBytes(
  accountId: string,
  apiToken: string,
  cloudflareId: string,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(blobUrl(accountId, cloudflareId), {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Range: `bytes=0-${MAX_BYTES - 1}`,
      },
    });
    if (!res.ok && res.status !== 206) {
      logger.warn("backfill.blob_fetch_failed", { cloudflare_id: cloudflareId, status: res.status });
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    logger.warn("backfill.blob_fetch_error", {
      cloudflare_id: cloudflareId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// EXIF extraction
// ---------------------------------------------------------------------------

type ExifResult = {
  caption: string | null;
  altText: string | null;
  tags: string[];
};

async function extractExif(bytes: Uint8Array): Promise<ExifResult> {
  try {
    const meta = await exifr.parse(Buffer.from(bytes), { iptc: true, exif: true, xmp: true });
    if (!meta) return { caption: null, altText: null, tags: [] };

    const rawCaption =
      (meta["Caption-Abstract"] as string | undefined) ??
      (meta.description as string | undefined) ??
      (meta.Headline as string | undefined) ??
      null;

    const rawAlt =
      (meta.Headline as string | undefined) ??
      (meta.ObjectName as string | undefined) ??
      (meta.Title as string | undefined) ??
      null;

    const rawTags: unknown = (meta.Keywords as unknown) ?? (meta.Subject as unknown) ?? [];
    const tagsArr = Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [];
    const tags = tagsArr
      .map((t: unknown) => String(t).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12);

    const caption = rawCaption ? String(rawCaption).trim().slice(0, 150) || null : null;
    const altText = rawAlt ? String(rawAlt).trim().slice(0, 100) || null : null;

    return { caption, altText, tags };
  } catch {
    return { caption: null, altText: null, tags: [] };
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
  if (!accountId || !apiToken) {
    logger.error("backfill.missing_cf_credentials", {});
    return NextResponse.json({ error: "Missing Cloudflare credentials" }, { status: 500 });
  }

  const supabase = getServiceRoleClient();

  // Fetch next batch of images that still need captions.
  const { data: rows, error } = await supabase
    .from("image_library")
    .select("id, cloudflare_id, filename, tags")
    .is("deleted_at", null)
    .or("caption.is.null,caption.eq.")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    logger.error("backfill.db_query_failed", { error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const total = rows?.length ?? 0;
  let exifSaved = 0;
  let noData = 0;
  let fetchErrors = 0;

  for (const row of rows ?? []) {
    const cloudflareId = row.cloudflare_id as string | null;
    if (!cloudflareId) {
      noData++;
      continue;
    }

    const bytes = await fetchOriginalBytes(accountId, apiToken, cloudflareId);
    if (!bytes) {
      fetchErrors++;
      continue;
    }

    const exif = await extractExif(bytes);
    if (!exif.caption && !exif.altText) {
      logger.debug("backfill.no_exif", { image_id: row.id, filename: row.filename });
      noData++;
      continue;
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (exif.caption) patch.caption = exif.caption;
    if (exif.altText) patch.alt_text = exif.altText;
    if (exif.tags.length > 0) {
      const existing = Array.isArray(row.tags) ? (row.tags as string[]) : [];
      patch.tags = Array.from(new Set([...existing, ...exif.tags]));
    }

    const { error: updateErr } = await supabase
      .from("image_library")
      .update(patch)
      .eq("id", row.id)
      .is("caption", null); // idempotency guard

    if (updateErr) {
      logger.error("backfill.update_failed", { image_id: row.id, error: updateErr.message });
      fetchErrors++;
    } else {
      logger.info("backfill.exif_saved", {
        image_id: row.id,
        filename: row.filename,
        caption: exif.caption?.slice(0, 60),
      });
      exifSaved++;
    }
  }

  // Check how many still remain for the response payload.
  const { count: remaining } = await supabase
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("caption.is.null,caption.eq.");

  logger.info("backfill.tick_complete", {
    processed: total,
    exif_saved: exifSaved,
    no_data: noData,
    errors: fetchErrors,
    remaining: remaining ?? "?",
  });

  return NextResponse.json({
    processed: total,
    exif_saved: exifSaved,
    no_data: noData,
    errors: fetchErrors,
    remaining: remaining ?? null,
    done: (remaining ?? 1) === 0,
  });
}
