/**
 * Backfill captions for image_library rows that have no caption.
 *
 * EXIF-first strategy: reads IPTC/EXIF/XMP metadata before calling Claude.
 * iStock images typically have Caption-Abstract + Headline populated, so
 * most can be captioned for free. Only images with no EXIF caption fall back
 * to Claude Haiku vision.
 *
 * COST ESTIMATE (claude-haiku-4-5-20251001):
 *   - Only images WITHOUT usable EXIF caption need Claude calls
 *   - Run --dry-run first to see the EXIF vs Claude split and actual cost
 *   - Full Claude fallback: ~$0.62 for 1,777 images (worst case)
 *
 * Rate limiting: BETWEEN_IMAGES_DELAY_MS applies only after Claude calls.
 *   EXIF-only images have no inter-image delay (no API call involved).
 * Retry: up to 3 attempts with exponential backoff (15 s, 30 s, 60 s) on 429.
 * Resume-safe: only processes rows where caption IS NULL or empty.
 *
 * Usage:
 *   npx tsx scripts/backfill-image-captions.ts              # EXIF-first, Claude fallback
 *   npx tsx scripts/backfill-image-captions.ts --dry-run    # download+EXIF, no writes, cost estimate
 *   npx tsx scripts/backfill-image-captions.ts --exif-only  # EXIF only, skip Claude entirely
 *   BETWEEN_IMAGES_DELAY=5000 npx tsx scripts/backfill-image-captions.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import exifr from "exifr";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? "", 10) || 10;
// Delay between batches (group of BATCH_SIZE images).
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY ?? "", 10) || 15_000;
// Delay between individual Claude API calls to stay ≤ 4.6 req/min (under 5/min org limit).
// Only applied after Claude calls — EXIF-only images have no delay.
// Set BETWEEN_IMAGES_DELAY=0 if the org rate limit has been raised.
const BETWEEN_IMAGES_DELAY_MS = parseInt(process.env.BETWEEN_IMAGES_DELAY ?? "", 10) || 13_000;
const MAX_RETRIES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB — well under Anthropic's limit

const DRY_RUN = process.argv.includes("--dry-run");
const EXIF_ONLY = process.argv.includes("--exif-only");

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!anthropicKey && !EXIF_ONLY) {
  console.error("Missing ANTHROPIC_API_KEY (required unless running --exif-only)");
  process.exit(1);
}

const svc = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

const cloudflareHash = process.env.CLOUDFLARE_IMAGES_HASH;
if (!cloudflareHash) {
  console.error("Missing CLOUDFLARE_IMAGES_HASH");
  process.exit(1);
}

function deliveryUrl(cloudflareId: string): string {
  return `https://imagedelivery.net/${cloudflareHash}/${cloudflareId}/public`;
}

// ---------------------------------------------------------------------------
// Image fetch
// ---------------------------------------------------------------------------

async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${MAX_IMAGE_BYTES - 1}` },
    });
    if (!res.ok && res.status !== 206 && res.status !== 200) {
      console.warn(`  fetch ${res.status}: ${url}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return { bytes, contentType: contentType.split(";")[0].trim() };
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
  tags: string[];
};

async function extractExifMetadata(bytes: Uint8Array): Promise<ExifResult> {
  try {
    const meta = await exifr.parse(Buffer.from(bytes), {
      iptc: true,
      exif: true,
      xmp: true,
    });

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

    const rawTags: unknown =
      (meta.Keywords as unknown) ?? (meta.Subject as unknown) ?? [];
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
// Claude captioning (fallback)
// ---------------------------------------------------------------------------

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message;
    if (msg.includes("rate_limit_error") || msg.includes("429")) return true;
  }
  if (typeof err === "object" && err !== null && "status" in err) {
    return (err as { status: number }).status === 429;
  }
  return false;
}

async function generateCaptionWithClaude(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExifResult> {
  if (!anthropic) throw new Error("Anthropic client not initialised");

  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const mediaType = validTypes.includes(mimeType)
    ? (mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif")
    : "image/jpeg";

  const base64 = Buffer.from(bytes).toString("base64");
  const RETRY_WAITS_MS = [15_000, 30_000, 60_000];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
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
                text: [
                  "Describe this image concisely for use in a business/marketing context.",
                  "Reply in exactly this format (one item per line):",
                  "CAPTION: <one sentence description, max 150 chars>",
                  "ALT: <short accessibility alt text, max 100 chars>",
                  "TAGS: <comma-separated keywords, max 5 tags>",
                ].join("\n"),
              },
            ],
          },
        ],
      });

      const text = msg.content[0]?.type === "text" ? msg.content[0].text : "";
      const captionMatch = /^CAPTION:\s*(.+)/m.exec(text);
      const altMatch = /^ALT:\s*(.+)/m.exec(text);
      const tagsMatch = /^TAGS:\s*(.+)/m.exec(text);

      const caption = captionMatch?.[1]?.trim().slice(0, 150) ?? null;
      const altText = altMatch?.[1]?.trim().slice(0, 100) ?? null;
      const tags = tagsMatch?.[1]
        ? tagsMatch[1]
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 5)
        : [];

      return { caption, altText, tags };
    } catch (err) {
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const waitMs = RETRY_WAITS_MS[attempt] ?? 60_000;
        console.warn(
          `  → rate limited, waiting ${waitMs / 1000}s (retry ${attempt + 1}/${MAX_RETRIES})...`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }

  throw new Error("generateCaptionWithClaude: max retries exceeded");
}

// ---------------------------------------------------------------------------
// Progress display
// ---------------------------------------------------------------------------

function printProgress(opts: {
  processed: number;
  total: number | string;
  exifCount: number;
  claudeCount: number;
  skipped: number;
  errors: number;
}) {
  const remaining =
    typeof opts.total === "number" ? opts.total - opts.processed : "?";
  console.log(
    `  [Progress] EXIF: ${opts.exifCount} | Claude: ${opts.claudeCount} | Skipped: ${opts.skipped} | Errors: ${opts.errors} | Remaining: ${remaining}`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const mode = DRY_RUN ? "DRY RUN" : EXIF_ONLY ? "LIVE — EXIF only (no Claude)" : "LIVE — EXIF-first, Claude fallback";
  console.log(`Backfill mode: ${mode}`);
  console.log(
    `Batch size: ${BATCH_SIZE} | Batch delay: ${BATCH_DELAY_MS}ms | Between Claude calls: ${BETWEEN_IMAGES_DELAY_MS}ms\n`,
  );

  const { count } = await svc
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("caption.is.null,caption.eq.");

  const total = count ?? 0;
  console.log(`Images needing captions: ${total}\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let exifCount = 0;
  let claudeCount = 0;
  let offset = 0;

  while (true) {
    const { data: rows, error } = await svc
      .from("image_library")
      .select("id, cloudflare_id, filename, caption, alt_text, tags")
      .is("deleted_at", null)
      .or("caption.is.null,caption.eq.")
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error(`DB query error: ${error.message}`);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      processed++;
      console.log(`[${processed}/${total}] ${row.id} (${row.filename ?? "no-filename"})`);

      // Resume-safe: skip if caption already set.
      if (row.caption && (row.caption as string).trim().length > 0) {
        console.log(`  → already has caption, skipping`);
        skipped++;
        continue;
      }

      const cloudflareId = row.cloudflare_id as string | null;
      if (!cloudflareId) {
        console.log(`  → no cloudflare_id, skipping`);
        skipped++;
        continue;
      }

      const url = deliveryUrl(cloudflareId);

      // ----- Dry-run path: download image, run EXIF, report — no writes -----
      if (DRY_RUN) {
        const fetchResult = await fetchImageBytes(url);
        if (!fetchResult) {
          console.log(`  → DRY RUN: fetch failed`);
          errors++;
          continue;
        }

        const exif = await extractExifMetadata(fetchResult.bytes);
        const hasExif = Boolean(exif.caption && exif.altText);

        if (hasExif) {
          exifCount++;
          console.log(`  → DRY RUN (EXIF): caption="${exif.caption}" alt="${exif.altText}" tags=[${exif.tags.join(", ")}]`);
        } else if (EXIF_ONLY) {
          skipped++;
          console.log(`  → DRY RUN (EXIF-only): no EXIF data, would skip`);
        } else {
          claudeCount++;
          console.log(`  → DRY RUN (Claude): no EXIF, would call Claude Haiku`);
        }
        continue;
      }

      // ----- Live path -----
      const fetchResult = await fetchImageBytes(url);
      if (!fetchResult) {
        console.log(`  → fetch failed, skipping`);
        errors++;
        continue;
      }

      if (fetchResult.bytes.length > MAX_IMAGE_BYTES) {
        console.log(
          `  → image too large (${Math.round(fetchResult.bytes.length / 1024 / 1024)}MB), skipping`,
        );
        skipped++;
        continue;
      }

      // Step 1: try EXIF extraction.
      const exif = await extractExifMetadata(fetchResult.bytes);
      const hasExif = Boolean(exif.caption && exif.altText);

      let result: ExifResult;
      let source: "exif" | "claude";

      if (hasExif) {
        result = exif;
        source = "exif";
        exifCount++;
        console.log(`  → EXIF: caption="${result.caption}" alt="${result.altText}" tags=[${result.tags.join(", ")}]`);
      } else if (EXIF_ONLY) {
        console.log(`  → no EXIF data, skipping (--exif-only)`);
        skipped++;
        continue;
      } else {
        // Step 2: fall back to Claude.
        console.log(`  → no EXIF, calling Claude Haiku...`);
        try {
          result = await generateCaptionWithClaude(fetchResult.bytes, fetchResult.contentType);
          source = "claude";
          claudeCount++;
          console.log(`  → Claude: caption="${result.caption}" alt="${result.altText}" tags=[${result.tags.join(", ")}]`);
        } catch (err) {
          console.error(
            `  → Anthropic error: ${err instanceof Error ? err.message : String(err)}`,
          );
          errors++;
          continue;
        }
      }

      // Persist to DB.
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (result.caption) patch.caption = result.caption;
      if (result.altText) patch.alt_text = result.altText;
      if (result.tags.length > 0) {
        const existing = Array.isArray(row.tags) ? (row.tags as string[]) : [];
        patch.tags = Array.from(new Set([...existing, ...result.tags]));
      }

      const { error: updateError } = await svc
        .from("image_library")
        .update(patch)
        .eq("id", row.id)
        .is("caption", null); // Idempotency guard.

      if (updateError) {
        console.error(`  → DB update error: ${updateError.message}`);
        errors++;
      } else {
        console.log(`  → updated ✓ [${source}]`);
        updated++;
      }

      // Rate-limit delay — only needed after Claude calls.
      if (source === "claude" && BETWEEN_IMAGES_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, BETWEEN_IMAGES_DELAY_MS));
      }
    }

    // Show running totals after each batch.
    printProgress({ processed, total, exifCount, claudeCount, skipped, errors });

    offset += BATCH_SIZE;

    if (rows.length === BATCH_SIZE) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Processed: ${processed} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);
  console.log(`Sources: EXIF: ${exifCount} | Claude: ${claudeCount}`);

  if (DRY_RUN) {
    const estimatedCost = claudeCount * 0.00035; // ~$0.00035/image at Haiku pricing
    console.log(`\nDry-run summary:`);
    console.log(`  Would use EXIF:   ${exifCount} images (free)`);
    console.log(`  Would use Claude: ${claudeCount} images (~$${estimatedCost.toFixed(3)} est.)`);
    console.log(`  Would skip:       ${skipped} images (no cloudflare_id or already captioned)`);
    if (EXIF_ONLY) {
      console.log(`  (--exif-only: ${total - exifCount - skipped} images with no EXIF would be left uncaptioned)`);
    }
    console.log(`(Dry run — no changes written)`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
