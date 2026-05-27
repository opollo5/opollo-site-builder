#!/usr/bin/env ts-node
/**
 * V1 → V2 social post model migration backfill.
 *
 * Decision reference: D3 (decisions-locked.md:38), D6 (decisions-locked.md:D6)
 *
 * Reads every social_post_master row and creates a corresponding
 * social_post_drafts row. Idempotent: uses idempotency_key =
 * 'v1-migration-{master.id}' so re-runs are safe.
 *
 * Usage:
 *   npx tsx scripts/migrate-v1-to-v2.ts               # live run (staging)
 *   npx tsx scripts/migrate-v1-to-v2.ts --dry-run     # log only, no writes
 *   npx tsx scripts/migrate-v1-to-v2.ts --batch 50    # custom batch size
 *
 * Safety gates:
 *   - Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 *   - Stops on any batch insert error (non-conflict).
 *   - 200ms pause between batches to reduce DB load.
 *   - Only writes rows for V1 posts where created_by is non-null (auth.users FK).
 *     Rows with null created_by are logged and skipped.
 *
 * Write-safety: this script is classified WRITE-SAFETY-CRITICAL.
 * Run on staging first. Verify row counts before running on production.
 * V1 tables are NOT touched — this is additive-only.
 */

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const BATCH_SIZE = (() => {
  const i = args.indexOf("--batch");
  return i !== -1 ? parseInt(args[i + 1], 10) : 100;
})();
const PAUSE_MS = 200;

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// State mapping — D6 (decisions-locked.md)
// ---------------------------------------------------------------------------

const STATE_MAP: Record<string, string> = {
  draft:                    "draft",
  pending_client_approval:  "pending_approval",
  approved:                 "scheduled",      // scheduled_at=NULL; held for manual scheduling in V2
  changes_requested:        "pending_approval",  // conservative: requires re-review
  pending_msp_release:      "pending_approval",  // conservative: requires explicit re-approval
  rejected:                 "rejected",
  scheduled:                "scheduled",
  publishing:               "publishing",
  published:                "published",
  failed:                   "failed",
};

function mapState(v1State: string | null): string {
  if (!v1State) return "draft";
  return STATE_MAP[v1State] ?? "draft";
}

// ---------------------------------------------------------------------------
// Media URL resolution
// ---------------------------------------------------------------------------

function resolveMediaUrl(asset: { source_url: string | null; storage_path: string }): string | null {
  if (asset.source_url) return asset.source_url;
  // storage_path-only: construct public Supabase storage URL
  // (only works for public buckets — verify bucket policy before relying on this)
  return `${SUPABASE_URL}/storage/v1/object/public/${asset.storage_path}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log(`V1 → V2 migration — ${DRY_RUN ? "DRY RUN" : "LIVE"}, batch_size=${BATCH_SIZE}`);

  // 1. Count V1 posts for progress reporting.
  const { count: totalCount, error: countError } = await svc
    .from("social_post_master")
    .select("*", { count: "exact", head: true });
  if (countError) { console.error("Count query failed:", countError.message); process.exit(1); }
  console.log(`Total V1 posts: ${totalCount ?? "unknown"}`);

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let offset = 0;

  // 2. Batch loop.
  for (;;) {
    const { data: masters, error: fetchError } = await svc
      .from("social_post_master")
      .select("id, company_id, created_by, state, master_text, link_url, source_type, created_at, updated_at")
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (fetchError) { console.error("Fetch batch failed:", fetchError.message); process.exit(1); }
    if (!masters || masters.length === 0) break;

    // Collect all master IDs in this batch for variant + schedule joins.
    const masterIds = masters.map((m) => m.id as string);

    // 3a. Fetch variants for this batch.
    const { data: variants } = await svc
      .from("social_post_variant")
      .select("post_master_id, platform, variant_text, connection_id, media_asset_ids")
      .in("post_master_id", masterIds);

    // 3b. Fetch schedule entries for this batch (latest non-cancelled entry per master).
    const { data: schedules } = await svc
      .from("social_schedule_entries")
      .select("post_variant_id, scheduled_at")
      .is("cancelled_at", null)
      .order("scheduled_at", { ascending: false });

    // 3c. Collect all connection_ids to batch-fetch profile_ids.
    const connectionIds = [...new Set(
      (variants ?? []).map((v) => v.connection_id as string).filter(Boolean),
    )];
    let connectionProfileMap: Record<string, string> = {};
    if (connectionIds.length > 0) {
      const { data: connections } = await svc
        .from("social_connections")
        .select("id, profile_id")
        .in("id", connectionIds);
      for (const c of connections ?? []) {
        if (c.profile_id) connectionProfileMap[c.id as string] = c.profile_id as string;
      }
    }

    // 3d. Collect all media_asset_ids to batch-fetch URLs.
    const allAssetIds = [
      ...new Set(
        (variants ?? [])
          .flatMap((v) => (v.media_asset_ids as string[] | null) ?? [])
          .filter(Boolean),
      ),
    ];
    let assetUrlMap: Record<string, string | null> = {};
    if (allAssetIds.length > 0) {
      const { data: assets } = await svc
        .from("social_media_assets")
        .select("id, source_url, storage_path")
        .in("id", allAssetIds);
      for (const a of assets ?? []) {
        assetUrlMap[a.id as string] = resolveMediaUrl({
          source_url: a.source_url as string | null,
          storage_path: a.storage_path as string,
        });
      }
    }

    // 4. Build variant lookup by post_master_id.
    const variantsByMaster: Record<string, typeof variants> = {};
    for (const v of variants ?? []) {
      const mid = v.post_master_id as string;
      if (!variantsByMaster[mid]) variantsByMaster[mid] = [];
      variantsByMaster[mid]!.push(v);
    }

    // 5. Build schedule lookup by post_variant_id (first match = most recent).
    const scheduleByVariant: Record<string, string> = {};
    for (const s of schedules ?? []) {
      const vid = s.post_variant_id as string;
      if (!scheduleByVariant[vid]) scheduleByVariant[vid] = s.scheduled_at as string;
    }

    // 6. Assemble V2 draft rows for this batch.
    const draftRows: Array<Record<string, unknown>> = [];
    for (const master of masters) {
      const masterId = master.id as string;

      // V2 created_by FK → auth.users (NOT NULL); platform_users.id = auth.users.id.
      if (!master.created_by) {
        console.warn(`  SKIP ${masterId}: created_by is null, cannot satisfy V2 NOT NULL FK`);
        skipped++;
        processed++;
        continue;
      }

      const masterVariants = variantsByMaster[masterId] ?? [];

      // Build target_profiles: unique profile_ids from all variants' connections.
      const profileIds = [
        ...new Set(
          masterVariants
            .map((v) => connectionProfileMap[v.connection_id as string])
            .filter(Boolean),
        ),
      ];
      const targetProfiles = profileIds.map((pid) => ({ profile_id: pid }));

      // Build platform_variants JSONB: {platform_key: {content?: string}}.
      const platformVariants: Record<string, { content?: string }> = {};
      for (const v of masterVariants) {
        const platform = v.platform as string;
        if (platform && v.variant_text) {
          platformVariants[platform] = { content: v.variant_text as string };
        }
      }

      // Build media_urls: resolve asset IDs from first variant (media is post-level in V2).
      const mediaUrls: string[] = [];
      const firstVariantAssetIds = (masterVariants[0]?.media_asset_ids as string[] | null) ?? [];
      for (const assetId of firstVariantAssetIds) {
        const url = assetUrlMap[assetId];
        if (url) mediaUrls.push(url);
      }

      // Resolve scheduled_at: find the earliest scheduled entry across all variants.
      let scheduledAt: string | null = null;
      const v2State = mapState(master.state as string);
      if (v2State === "scheduled" || v2State === "published") {
        const variantIds = masterVariants.map((v) => v.post_master_id as string);
        const candidateTimes = variantIds
          .map((vid) => scheduleByVariant[vid])
          .filter(Boolean)
          .sort();
        scheduledAt = candidateTimes[0] ?? null;
      }

      draftRows.push({
        company_id:          master.company_id,
        created_by:          master.created_by,
        updated_by:          master.created_by,       // V1 has no updated_by; use created_by
        state:               v2State,
        content:             (master.master_text as string | null) ?? "",
        link_url:            master.link_url ?? null,
        source_type:         master.source_type ?? null,
        media_urls:          mediaUrls,
        target_profiles:     targetProfiles,
        platform_variants:   platformVariants,
        scheduled_at:        scheduledAt,
        idempotency_key:     `v1-migration-${masterId}`,
        created_at:          master.created_at,
        updated_at:          master.updated_at,
      });
    }

    processed += masters.length;

    if (draftRows.length === 0) {
      console.log(`  Batch [${offset}–${offset + masters.length - 1}]: all ${masters.length} skipped`);
      offset += masters.length;
      if (masters.length < BATCH_SIZE) break;
      await pause(PAUSE_MS);
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would insert ${draftRows.length} rows (batch ${offset}–${offset + masters.length - 1})`);
      inserted += draftRows.length;
    } else {
      // ON CONFLICT DO NOTHING via idempotency_key unique partial index.
      const { error: insertError, data: insertData } = await svc
        .from("social_post_drafts")
        .upsert(draftRows, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true })
        .select("id");
      if (insertError) {
        console.error(`  Batch insert failed at offset ${offset}:`, insertError.message);
        process.exit(1);
      }
      const newRows = (insertData ?? []).length;
      inserted += newRows;
      console.log(`  Batch [${offset}–${offset + masters.length - 1}]: ${newRows} inserted, ${draftRows.length - newRows} were duplicates`);
    }

    offset += masters.length;
    if (masters.length < BATCH_SIZE) break;
    await pause(PAUSE_MS);
  }

  console.log(`\nDone. processed=${processed}, inserted=${inserted}, skipped=${skipped}`);
  if (DRY_RUN) console.log("(Dry run — no writes made)");
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
