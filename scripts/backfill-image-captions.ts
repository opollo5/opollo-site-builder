/**
 * Backfill AI-generated captions for image_library rows that have no caption.
 *
 * COST ESTIMATE (claude-haiku-4-5-20251001):
 *   - 1,777 images × ~1,100 input tokens (image+prompt) ≈ 1.95M tokens → ~$0.49
 *   - 1,777 images × ~60 output tokens (caption+alt) ≈ 107K tokens → ~$0.13
 *   - Total ≈ $0.62 at May 2025 Haiku pricing ($0.25/$1.25 per 1M in/out)
 *   - Plus Cloudflare egress for ~1,777 image fetches (typically negligible)
 *
 * Usage:
 *   npx tsx scripts/backfill-image-captions.ts
 *   npx tsx scripts/backfill-image-captions.ts --dry-run
 *   npx tsx scripts/backfill-image-captions.ts --batch-size 5 --delay 3000
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? "", 10) || 10;
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY ?? "", 10) || 2000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB to stay well under Anthropic limits

const DRY_RUN = process.argv.includes("--dry-run");

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
if (!anthropicKey) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

const svc = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: anthropicKey });

const cloudflareHash = process.env.CLOUDFLARE_IMAGES_HASH;
if (!cloudflareHash) {
  console.error("Missing CLOUDFLARE_IMAGES_HASH");
  process.exit(1);
}

function deliveryUrl(cloudflareId: string): string {
  return `https://imagedelivery.net/${cloudflareHash}/${cloudflareId}/public`;
}

// ---------------------------------------------------------------------------
// Image fetch (header bytes only via Range request)
// ---------------------------------------------------------------------------

async function fetchImageBytes(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    // Try Range request first to limit bandwidth. Cloudflare honours it.
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
// AI captioning
// ---------------------------------------------------------------------------

async function generateCaption(
  imageId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ caption: string | null; altText: string | null; tags: string[] }> {
  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const mediaType = validTypes.includes(mimeType)
    ? (mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif")
    : "image/jpeg";

  const base64 = Buffer.from(bytes).toString("base64");

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
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Backfill mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`Batch size: ${BATCH_SIZE} | Delay between batches: ${BATCH_DELAY_MS}ms\n`);

  // Count total rows to process.
  const { count } = await svc
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .or("caption.is.null,caption.eq.");

  console.log(`Images needing captions: ${count ?? "unknown"}\n`);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
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
      const total = count ?? "?";
      console.log(`[${processed}/${total}] ${row.id} (${row.filename ?? "no-filename"})`);

      // Resume-safe: skip if caption already set (another run may have filled it).
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

      if (DRY_RUN) {
        console.log(`  → DRY RUN: would fetch ${url} and generate caption`);
        continue;
      }

      // Fetch image bytes.
      const fetchResult = await fetchImageBytes(url);
      if (!fetchResult) {
        console.log(`  → fetch failed, skipping`);
        errors++;
        continue;
      }

      if (fetchResult.bytes.length > MAX_IMAGE_BYTES) {
        console.log(`  → image too large (${Math.round(fetchResult.bytes.length / 1024 / 1024)}MB), skipping`);
        skipped++;
        continue;
      }

      // Generate AI caption.
      let result: { caption: string | null; altText: string | null; tags: string[] };
      try {
        result = await generateCaption(row.id as string, fetchResult.bytes, fetchResult.contentType);
      } catch (err) {
        console.error(`  → Anthropic error: ${err instanceof Error ? err.message : String(err)}`);
        errors++;
        continue;
      }

      console.log(`  → caption: ${result.caption ?? "(none)"}`);
      console.log(`  → alt: ${result.altText ?? "(none)"}`);
      console.log(`  → tags: ${result.tags.join(", ") || "(none)"}`);

      // Update DB row.
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (result.caption) patch.caption = result.caption;
      if (result.altText) patch.alt_text = result.altText;
      if (result.tags.length > 0) {
        // Merge with existing tags (don't overwrite operator-set tags).
        const existing = Array.isArray(row.tags) ? (row.tags as string[]) : [];
        const merged = Array.from(new Set([...existing, ...result.tags]));
        patch.tags = merged;
      }

      const { error: updateError } = await svc
        .from("image_library")
        .update(patch)
        .eq("id", row.id)
        .is("caption", null); // Idempotency guard: only update if caption is still null.

      if (updateError) {
        console.error(`  → DB update error: ${updateError.message}`);
        errors++;
      } else {
        console.log(`  → updated ✓`);
        updated++;
      }
    }

    offset += BATCH_SIZE;

    // Delay between batches to respect rate limits.
    if (rows.length === BATCH_SIZE) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`Processed: ${processed} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);
  if (DRY_RUN) {
    console.log(`(Dry run — no changes written)`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
