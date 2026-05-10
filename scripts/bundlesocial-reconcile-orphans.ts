#!/usr/bin/env -S npx tsx
/**
 * scripts/bundlesocial-reconcile-orphans.ts
 *
 * BSP-4 — orphan-team reconciliation.
 *
 * Compares the bundle.social organisation's team list against the team
 * ids tracked in our DB (platform_companies.bundle_social_team_id +
 * platform_social_profiles.bundle_social_team_id). Reports orphans
 * (remote teams we don't track) and dangling refs (DB rows pointing at
 * remote teams that no longer exist).
 *
 * Modes:
 *   (default — report only)
 *     Lists orphans + dangling refs. Does not call any mutating API.
 *
 *   --delete-dry-run
 *     Lists orphans that WOULD be deleted under the safety filter
 *     (older than --min-age-min, default 60 minutes). Does not call
 *     the delete API.
 *
 *   --delete --confirm-delete
 *     Actually deletes orphans that pass the safety filter. Requires
 *     BOTH flags to prevent accidental nuke-from-orbit.
 *
 * Usage:
 *   npx tsx scripts/bundlesocial-reconcile-orphans.ts
 *   npx tsx scripts/bundlesocial-reconcile-orphans.ts --delete-dry-run
 *   npx tsx scripts/bundlesocial-reconcile-orphans.ts --delete-dry-run --min-age-min=120
 *   npx tsx scripts/bundlesocial-reconcile-orphans.ts --delete --confirm-delete
 *
 * Required env:
 *   BUNDLE_SOCIAL_API
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { Bundlesocial } from "bundlesocial";
import { config } from "dotenv";

import {
  computeReconcileDiff,
  filterDeleteSafeOrphans,
  type ReconcileTeam,
} from "../lib/platform/social/bundle-social/reconcile";

config({ path: ".env.local" });

type Args = {
  delete: boolean;
  confirmDelete: boolean;
  deleteDryRun: boolean;
  minAgeMin: number;
};

function parseArgs(argv: ReadonlyArray<string>): Args {
  const args: Args = {
    delete: false,
    confirmDelete: false,
    deleteDryRun: false,
    minAgeMin: 60,
  };
  for (const a of argv) {
    if (a === "--delete") args.delete = true;
    else if (a === "--confirm-delete") args.confirmDelete = true;
    else if (a === "--delete-dry-run") args.deleteDryRun = true;
    else if (a.startsWith("--min-age-min=")) {
      const n = Number(a.split("=")[1]);
      if (Number.isFinite(n) && n >= 0) args.minAgeMin = n;
    }
  }
  return args;
}

async function listAllTeams(client: Bundlesocial): Promise<ReconcileTeam[]> {
  // bundle.social pagination via limit + offset.
  const PAGE = 100;
  const out: ReconcileTeam[] = [];
  let offset = 0;
  // Hard cap to prevent infinite loops on a misbehaving SDK.
  for (let page = 0; page < 50; page++) {
    const resp = (await client.team.teamGetList({
      limit: PAGE,
      offset,
    })) as { items?: Array<{ id: string; name: string; createdAt?: string | null }> };
    const items = resp.items ?? [];
    for (const t of items) {
      out.push({
        id: t.id,
        name: t.name,
        createdAt: t.createdAt ?? null,
      });
    }
    if (items.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

async function readTrackedIds(supabaseUrl: string, serviceRoleKey: string): Promise<Set<string>> {
  const svc = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const tracked = new Set<string>();

  const { data: companies, error: cErr } = await svc
    .from("platform_companies")
    .select("bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);
  if (cErr) throw new Error(`read companies: ${cErr.message}`);
  for (const row of companies ?? []) {
    const id = (row as { bundle_social_team_id: string | null }).bundle_social_team_id;
    if (id) tracked.add(id);
  }

  const { data: profiles, error: pErr } = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);
  if (pErr) throw new Error(`read profiles: ${pErr.message}`);
  for (const row of profiles ?? []) {
    const id = (row as { bundle_social_team_id: string | null }).bundle_social_team_id;
    if (id) tracked.add(id);
  }

  return tracked;
}

async function main(): Promise<void> {
  const apiKey = process.env.BUNDLE_SOCIAL_API;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing required env: BUNDLE_SOCIAL_API, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));

  if (args.delete && !args.confirmDelete) {
    console.error("Refusing to delete without --confirm-delete (safety guard).");
    process.exit(1);
  }

  const client = new Bundlesocial(apiKey);

  console.log("Listing bundle.social teams...");
  const remoteTeams = await listAllTeams(client);
  console.log(`  ${remoteTeams.length} teams visible.`);

  console.log("Reading tracked team ids from Supabase...");
  const tracked = await readTrackedIds(supabaseUrl, serviceRoleKey);
  console.log(`  ${tracked.size} tracked.`);

  const report = computeReconcileDiff(remoteTeams, tracked);
  console.log("");
  console.log(`Remote total:  ${report.totalRemote}`);
  console.log(`Tracked total: ${report.totalTracked}`);
  console.log(`Orphans:       ${report.orphans.length}`);
  console.log(`Dangling refs: ${report.danglingRefs.length}`);

  if (report.orphans.length > 0) {
    console.log("");
    console.log("ORPHANS (remote teams not tracked in DB):");
    for (const t of report.orphans) {
      console.log(
        `  ${t.id}  ${t.createdAt ?? "no-createdAt"}  ${t.name}`,
      );
    }
  }

  if (report.danglingRefs.length > 0) {
    console.log("");
    console.log("DANGLING REFS (DB rows pointing at non-existent remote teams):");
    for (const id of report.danglingRefs) {
      console.log(`  ${id}`);
    }
  }

  if (!args.delete && !args.deleteDryRun) {
    console.log("");
    console.log("(report only — pass --delete-dry-run to preview deletes)");
    return;
  }

  const minAgeMs = args.minAgeMin * 60 * 1000;
  const deleteSafe = filterDeleteSafeOrphans(report.orphans, new Date(), minAgeMs);

  console.log("");
  console.log(
    `Delete-safe orphans (createdAt > ${args.minAgeMin}m old, with valid createdAt): ${deleteSafe.length}`,
  );
  for (const t of deleteSafe) {
    console.log(`  ${t.id}  ${t.createdAt}  ${t.name}`);
  }

  if (args.deleteDryRun) {
    console.log("");
    console.log("(dry-run only — no deletes issued)");
    return;
  }

  // --delete --confirm-delete path.
  console.log("");
  console.log("DELETING delete-safe orphans...");
  let ok = 0;
  let failed = 0;
  for (const t of deleteSafe) {
    try {
      await client.team.teamDeleteTeam({ id: t.id });
      console.log(`  deleted ${t.id}`);
      ok++;
    } catch (err) {
      console.error(`  FAILED ${t.id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }
  console.log("");
  console.log(`Done. Deleted ${ok}, failed ${failed}.`);
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
