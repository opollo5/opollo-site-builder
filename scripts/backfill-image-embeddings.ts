/**
 * Backfill caption embeddings for image_library rows that have a caption
 * but no caption_embedding.
 *
 * Spec 05 — companion to migration 0108. Idempotent: safe to re-run; skips
 * rows that already have an embedding. Skips rows with no caption /
 * alt_text / tags / title / filename to embed.
 *
 * Required env vars (add to .env.local):
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-image-embeddings.ts
 *
 * Or, on PowerShell:
 *   Get-Content .env.local | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { Set-Item "Env:$($Matches[1])" $Matches[2] } }
 *   npm run backfill:image-embeddings
 *
 * Cost: text-embedding-3-small is $0.02 per 1M tokens. The 9k iStock
 * library should backfill for roughly $0.10 total.
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE ?? "", 10) || 100;
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS ?? "", 10) || 200;
const OPENAI_EMBED_ENDPOINT = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBED_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_INPUT_CHARS = 24000;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiKey = process.env.OPENAI_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
if (!openaiKey) {
  console.error("Missing OPENAI_API_KEY in env.");
  process.exit(1);
}

const svc = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// Compose / embed helpers (mirrors lib/images/embed.ts; intentionally
// duplicated so the script is self-contained for a one-shot backfill).
// ---------------------------------------------------------------------------

interface ImageRow {
  id: string;
  caption: string | null;
  alt_text: string | null;
  tags: string[] | null;
  title: string | null;
  filename: string | null;
}

function composeInput(row: ImageRow): string | null {
  const parts: string[] = [];
  const push = (s: string | null | undefined) => {
    if (typeof s === "string" && s.trim()) parts.push(s.trim());
  };
  push(row.title);
  push(row.caption);
  push(row.alt_text);
  if (row.tags && row.tags.length > 0) {
    const joined = row.tags.map((t) => (t ?? "").trim()).filter(Boolean).join(", ");
    if (joined) parts.push(`Tags: ${joined}`);
  }
  push(row.filename);
  if (parts.length === 0) return null;
  return parts.join(". ").replace(/\s+/g, " ").slice(0, MAX_INPUT_CHARS);
}

async function embedText(text: string): Promise<number[]> {
  const res = await fetch(OPENAI_EMBED_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${openaiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
  const vec = json.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Malformed embedding (length=${Array.isArray(vec) ? vec.length : "n/a"})`);
  }
  return vec as number[];
}

function vectorToLiteral(vec: readonly number[]): string {
  return `[${vec.join(",")}]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Stats {
  scanned: number;
  embedded: number;
  skippedNoInput: number;
  errors: number;
}

async function main(): Promise<void> {
  console.log(
    `Backfilling caption embeddings (batch=${BATCH_SIZE}, delay=${BATCH_DELAY_MS}ms)…`,
  );
  const stats: Stats = { scanned: 0, embedded: 0, skippedNoInput: 0, errors: 0 };
  const errorSamples: Array<{ id: string; error: string }> = [];
  const skippedSamples: string[] = [];

  let cursorCreatedAt: string | null = null;

  while (true) {
    let q = svc
      .from("image_library")
      .select("id, caption, alt_text, tags, title, filename, created_at")
      .is("deleted_at", null)
      .is("caption_embedding", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (cursorCreatedAt) {
      q = q.gt("created_at", cursorCreatedAt);
    }

    const { data, error } = await q;
    if (error) {
      console.error(`Query failed: ${error.message}`);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      stats.scanned++;
      const r = row as ImageRow & { created_at: string };
      cursorCreatedAt = r.created_at;
      const input = composeInput(r);
      if (!input) {
        stats.skippedNoInput++;
        if (skippedSamples.length < 20) skippedSamples.push(r.id);
        continue;
      }
      try {
        const vec = await embedText(input);
        const { error: upErr } = await svc
          .from("image_library")
          .update({
            caption_embedding: vectorToLiteral(vec),
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        if (upErr) {
          stats.errors++;
          if (errorSamples.length < 10) {
            errorSamples.push({ id: r.id, error: upErr.message });
          }
          continue;
        }
        stats.embedded++;
        if (stats.embedded % 100 === 0) {
          console.log(
            `  …${stats.embedded} embedded, ${stats.skippedNoInput} skipped, ${stats.errors} errors`,
          );
        }
      } catch (err) {
        stats.errors++;
        if (errorSamples.length < 10) {
          errorSamples.push({
            id: r.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await sleep(BATCH_DELAY_MS);
  }

  // Report.
  const totalRes = await svc
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  const totalActive = totalRes.count ?? 0;
  const populatedRes = await svc
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .not("caption_embedding", "is", null);
  const populated = populatedRes.count ?? 0;

  console.log("");
  console.log("Backfill complete.");
  console.log(`  Library size (active):       ${totalActive}`);
  console.log(`  Rows scanned this run:       ${stats.scanned}`);
  console.log(`  Embeddings generated:        ${stats.embedded}`);
  console.log(`  Skipped (no caption/etc):    ${stats.skippedNoInput}`);
  console.log(`  Errors:                      ${stats.errors}`);
  console.log(`  Embeddings populated total:  ${populated}/${totalActive}`);
  if (skippedSamples.length > 0) {
    console.log(`  First skipped ids:           ${skippedSamples.slice(0, 5).join(", ")}…`);
  }
  if (errorSamples.length > 0) {
    console.log("  First errors:");
    for (const s of errorSamples.slice(0, 5)) {
      console.log(`    ${s.id}: ${s.error}`);
    }
  }
  const missingPct =
    totalActive > 0 ? ((totalActive - populated) / totalActive) * 100 : 0;
  if (missingPct > 5) {
    console.log("");
    console.log(
      `WARNING: ${missingPct.toFixed(1)}% of the library still lacks an embedding (>5% threshold).`,
    );
    console.log("Per Spec 05 PR C scope, file a follow-up to caption images that have no metadata.");
  }
}

void main().catch((err) => {
  console.error("Backfill aborted:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
