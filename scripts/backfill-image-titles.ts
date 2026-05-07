#!/usr/bin/env -S npx tsx
/**
 * backfill-image-titles.ts
 *
 * Filename-only metadata backfill for image_library rows that have title IS NULL.
 * Requires no Cloudflare credentials — derives metadata purely from the filename.
 *
 * For iStock files (iStock-2216873274.jpg):
 *   title    = "iStock Image 2216873274"
 *   alt_text = "iStock Image 2216873274"   (when alt_text IS NULL)
 *   caption  = "iStock stock photography"  (when caption IS NULL)
 *   tags     = ["istock", "stock photography"] (when tags IS NULL or empty)
 *
 * For other files:
 *   title    = humanised filename ("my-photo.jpg" → "my photo")
 *   alt_text = same as title
 *
 * The EXIF extraction pipeline (scripts/backfill-image-captions.ts or the
 * cron/admin trigger) will overwrite these with real IPTC data when it runs
 * with Cloudflare credentials — this backfill is intentionally a placeholder
 * to make the library usable immediately.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-image-titles.ts [--dry-run] [--limit N] [--confirm]
 *
 * Required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type CliArgs = { dryRun: boolean; confirm: boolean; limit: number | null };

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, confirm: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--confirm") args.confirm = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") { printUsage(); process.exit(0); }
    else { console.error(`Unknown flag: ${a}`); printUsage(); process.exit(2); }
  }
  return args;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: tsx scripts/backfill-image-titles.ts [options]",
      "  --dry-run    Show what would happen without writing.",
      "  --limit N    Process at most N rows.",
      "  --confirm    Required to write to the database.",
      "",
      "Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Metadata derivation from filename
// ---------------------------------------------------------------------------

const ISTOCK_RE = /^istock[-_](\d{6,})/i;

function deriveTitle(filename: string | null): string | null {
  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, "");
  const m = ISTOCK_RE.exec(base);
  if (m) return `iStock Image ${m[1]}`;
  const human = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return human || null;
}

function isIstock(filename: string | null): boolean {
  return !!filename && ISTOCK_RE.test(filename);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// PostgREST .in([...N UUIDs]) generates a URL that exceeds server limits at N>~100.
// Use range()-based pagination to fetch rows in pages without the .in() issue.
const PAGE_SIZE = 200;
const CONCURRENCY = 25;

type Row = {
  id: string;
  filename: string | null;
  caption: string | null;
  alt_text: string | null;
  tags: string[] | null;
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) { console.error("SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL not set."); return 1; }
  if (!supabaseKey) { console.error("SUPABASE_SERVICE_ROLE_KEY not set."); return 1; }

  const svc = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  const { count: totalCount, error: cntErr } = await svc
    .from("image_library")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .is("title", null);
  if (cntErr) { console.error(`Count failed: ${cntErr.message}`); return 1; }

  const cap = args.limit !== null
    ? Math.min(args.limit, totalCount ?? 0)
    : (totalCount ?? 0);

  console.log(
    [
      "backfill-image-titles",
      `  Rows with title=NULL: ${totalCount ?? "?"}`,
      `  Will process:         ${cap}`,
      `  Mode:                 ${args.dryRun ? "DRY RUN" : "LIVE"}`,
      "",
    ].join("\n"),
  );

  if (args.dryRun) { console.log("Dry-run — no writes."); return 0; }
  if (!args.confirm) { process.stderr.write("Pass --confirm to write.\n"); return 2; }

  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  let totalProcessed = 0;

  // Always fetch from offset 0: as we update rows they leave the title=NULL
  // filtered set, so the "next page" is always the first PAGE_SIZE remaining rows.
  // Using an incrementing offset would skip rows equal to what we just removed.
  while (totalProcessed < cap) {
    const pageLimit = Math.min(PAGE_SIZE, cap - totalProcessed);
    const { data: rows, error: rowErr } = await svc
      .from("image_library")
      .select("id, filename, caption, alt_text, tags")
      .is("deleted_at", null)
      .is("title", null)
      .order("created_at", { ascending: true })
      .range(0, pageLimit - 1);
    if (rowErr) { console.error(`Page fetch failed: ${rowErr.message}`); return 1; }
    if (!rows || rows.length === 0) break;

    // Build per-row patches.
    type Patch = {
      id: string;
      title: string;
      alt_text?: string;
      caption?: string;
      tags?: string[];
      updated_at: string;
    };
    const patches: Patch[] = [];
    for (const row of rows as Row[]) {
      const title = deriveTitle(row.filename);
      if (!title) { skipped++; continue; }
      const patch: Patch = { id: row.id, title, updated_at: now };
      if (!row.alt_text) patch.alt_text = title;
      if (!row.caption && isIstock(row.filename)) patch.caption = "iStock stock photography";
      const tagsEmpty = !row.tags || (row.tags as string[]).length === 0;
      if (tagsEmpty && isIstock(row.filename)) patch.tags = ["istock", "stock photography"];
      patches.push(patch);
    }

    // Write concurrently in slices of CONCURRENCY.
    for (let ci = 0; ci < patches.length; ci += CONCURRENCY) {
      const slice = patches.slice(ci, ci + CONCURRENCY);
      await Promise.all(
        slice.map(async ({ id, ...fields }) => {
          const { error } = await svc
            .from("image_library")
            .update(fields)
            .eq("id", id)
            .is("title", null);
          if (error) {
            console.warn(`  [${id}] update failed: ${error.message}`);
          } else {
            updated++;
          }
        }),
      );
    }

    totalProcessed += rows.length;
    console.log(`  ${totalProcessed}/${cap} processed — updated so far: ${updated}`);
    if (rows.length < pageLimit) break; // last page
  }

  console.log(
    [
      "",
      "--- Done ---",
      `Processed: ${totalProcessed}`,
      `Updated:   ${updated}`,
      `Skipped:   ${skipped} (no derivable title)`,
    ].join("\n"),
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => { console.error("Fatal:", err); process.exit(1); },
);
