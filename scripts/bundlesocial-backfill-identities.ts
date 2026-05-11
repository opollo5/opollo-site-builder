#!/usr/bin/env -S npx tsx
/**
 * Cross-tenant identity-leak defence — Layer 4 backfill.
 *
 * Walks every social_connections row that doesn't yet have its identity
 * columns populated (migration 0122), calls socialAccountGetByType for
 * the (team, type) pair, computes the identity hash, and UPDATEs the row.
 *
 * After the per-row pass, runs the cross-tenant detector and prints a
 * report of any existing collisions. Does NOT mutate any pre-existing
 * cross-tenant rows — operator decides per-pair via the admin
 * maintenance page.
 *
 * Idempotent. Resumable. Rate-limited.
 *
 * Usage:
 *   npx tsx scripts/bundlesocial-backfill-identities.ts            # writes
 *   npx tsx scripts/bundlesocial-backfill-identities.ts --dry-run  # no writes
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Bundlesocial } from "bundlesocial";

config({ path: ".env.production.local" });
config({ path: ".env.local" });

// Resume-state lives alongside the script, not in os.tmpdir() (CodeQL:
// avoid insecure temp-dir file creation). Add to .gitignore if needed.
const STATE_FILE = path.join(__dirname, ".backfill-identities-state.json");
const PER_REQUEST_DELAY_MS = 100; // ≤ 10 SDK calls/sec.

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? requireEnv("SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const bundleApi = requireEnv("BUNDLE_SOCIAL_API");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});
const client = new Bundlesocial(bundleApi);

const dryRun = process.argv.includes("--dry-run");

function computeIdentityHash(
  platform: string,
  accountId: string | null,
  userId: string | null,
): string | null {
  if (!accountId && !userId) return null;
  return createHash("sha256")
    .update(`${platform}:${accountId ?? ""}:${userId ?? ""}`)
    .digest("hex");
}

const BUNDLE_TYPE_BY_PLATFORM: Record<string, string> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

type State = { processed_ids: string[] };

function readState(): State {
  if (!fs.existsSync(STATE_FILE)) return { processed_ids: [] };
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
  } catch {
    return { processed_ids: [] };
  }
}

function writeState(s: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type IdentityResolution = {
  external_account_id: string | null;
  external_user_id: string | null;
};

const teamTypeCache = new Map<string, IdentityResolution>();

async function resolveForRow(args: {
  teamId: string;
  platformDbValue: string;
}): Promise<IdentityResolution> {
  const bundleType = BUNDLE_TYPE_BY_PLATFORM[args.platformDbValue];
  if (!bundleType) return { external_account_id: null, external_user_id: null };
  const cacheKey = `${args.teamId}::${bundleType}`;
  const cached = teamTypeCache.get(cacheKey);
  if (cached) return cached;

  try {
    const resp = (await client.socialAccount.socialAccountGetByType({
      teamId: args.teamId,
      type: bundleType as
        | "TIKTOK" | "YOUTUBE" | "INSTAGRAM" | "FACEBOOK" | "TWITTER"
        | "THREADS" | "LINKEDIN" | "PINTEREST" | "REDDIT" | "MASTODON"
        | "DISCORD" | "SLACK" | "BLUESKY" | "GOOGLE_BUSINESS",
    })) as { externalId?: string | null; userId?: string | null };
    const result: IdentityResolution = {
      external_account_id: resp.externalId ?? null,
      external_user_id: resp.userId ?? null,
    };
    teamTypeCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.log(
      `    WARN resolveForRow(${args.teamId}, ${bundleType}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { external_account_id: null, external_user_id: null };
  }
}

async function main(): Promise<void> {
  console.log(`[backfill-identities] starting (${dryRun ? "DRY-RUN" : "WRITE"})`);
  const state = readState();
  const processedIds = new Set(state.processed_ids);

  const rows = await supabase
    .from("social_connections")
    .select(
      "id, company_id, profile_id, platform, bundle_social_account_id, external_account_id, external_user_id, external_identity_hash, status",
    );
  if (rows.error) {
    console.error(`Failed: ${rows.error.message}`);
    process.exit(1);
  }

  const profiles = await supabase
    .from("platform_social_profiles")
    .select("id, bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);
  if (profiles.error) {
    console.error(`Failed: ${profiles.error.message}`);
    process.exit(1);
  }
  const teamByProfile = new Map<string, string>(
    (profiles.data ?? []).map((p) => [
      p.id as string,
      p.bundle_social_team_id as string,
    ]),
  );

  const companies = await supabase
    .from("platform_companies")
    .select("id, bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);
  if (companies.error) {
    console.error(`Failed: ${companies.error.message}`);
    process.exit(1);
  }
  const teamByCompany = new Map<string, string>(
    (companies.data ?? []).map((c) => [
      c.id as string,
      c.bundle_social_team_id as string,
    ]),
  );

  console.log(`[backfill-identities] ${(rows.data ?? []).length} rows`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows.data ?? []) {
    const id = row.id as string;
    if (processedIds.has(id)) {
      skipped++;
      continue;
    }
    const teamId =
      teamByProfile.get((row.profile_id as string | null) ?? "") ??
      teamByCompany.get(row.company_id as string);
    if (!teamId) {
      console.log(`  SKIP ${id} — no team_id`);
      processedIds.add(id);
      writeState({ processed_ids: [...processedIds] });
      skipped++;
      continue;
    }

    const identity = await resolveForRow({
      teamId,
      platformDbValue: row.platform as string,
    });
    const hash = computeIdentityHash(
      row.platform as string,
      identity.external_account_id,
      identity.external_user_id,
    );

    if (
      identity.external_account_id === (row.external_account_id ?? null) &&
      identity.external_user_id === (row.external_user_id ?? null) &&
      hash === (row.external_identity_hash ?? null)
    ) {
      processedIds.add(id);
      writeState({ processed_ids: [...processedIds] });
      skipped++;
      continue;
    }

    console.log(
      `  ${dryRun ? "(dry)" : "UPDATE"} ${id} ${row.platform} account=${identity.external_account_id ?? "null"} user=${identity.external_user_id ?? "null"}`,
    );

    if (!dryRun) {
      const update = await supabase
        .from("social_connections")
        .update({
          external_account_id: identity.external_account_id,
          external_user_id: identity.external_user_id,
          external_identity_hash: hash,
          ...(identity.external_account_id || identity.external_user_id
            ? {}
            : { status: "pending_identity" }),
        })
        .eq("id", id);
      if (update.error) {
        console.error(`    FAILED ${id}: ${update.error.message}`);
        failed++;
        continue;
      }
    }
    updated++;
    processedIds.add(id);
    writeState({ processed_ids: [...processedIds] });
    await sleep(PER_REQUEST_DELAY_MS);
  }

  console.log(
    `[backfill-identities] done — updated=${updated} skipped=${skipped} failed=${failed}`,
  );

  // Detector report.
  console.log("\n=== Cross-tenant detector report ===");
  const after = await supabase
    .from("social_connections")
    .select(
      "id, company_id, profile_id, platform, display_name, external_account_id, external_user_id, external_identity_hash",
    );
  if (after.error) {
    console.error(`Detector failed: ${after.error.message}`);
    process.exit(1);
  }
  type Row = {
    id: string;
    company_id: string;
    profile_id: string | null;
    platform: string;
    display_name: string | null;
    external_account_id: string | null;
    external_user_id: string | null;
    external_identity_hash: string | null;
  };
  const rowsAll = (after.data ?? []) as Row[];

  const byHash = new Map<string, Row[]>();
  const byAccount = new Map<string, Row[]>();
  const byUser = new Map<string, Row[]>();
  for (const r of rowsAll) {
    if (r.external_identity_hash) {
      const arr = byHash.get(r.external_identity_hash) ?? [];
      arr.push(r);
      byHash.set(r.external_identity_hash, arr);
    }
    if (r.external_account_id) {
      const k = `${r.platform}::${r.external_account_id}`;
      const arr = byAccount.get(k) ?? [];
      arr.push(r);
      byAccount.set(k, arr);
    }
    if (r.external_user_id) {
      const k = `${r.platform}::${r.external_user_id}`;
      const arr = byUser.get(k) ?? [];
      arr.push(r);
      byUser.set(k, arr);
    }
  }

  const hashDupes = [...byHash.values()].filter(
    (a) => new Set(a.map((r) => r.company_id)).size > 1,
  );
  const accountDupes = [...byAccount.values()].filter(
    (a) => new Set(a.map((r) => r.company_id)).size > 1,
  );
  const userDupes = [...byUser.values()].filter(
    (a) => new Set(a.map((r) => r.company_id)).size > 1,
  );

  console.log(`Hash duplicates:        ${hashDupes.length}`);
  console.log(`Account-id duplicates:  ${accountDupes.length}`);
  console.log(`User-id duplicates:     ${userDupes.length}`);

  for (const [label, groups] of [
    ["Hash duplicates", hashDupes] as const,
    ["Account-id duplicates", accountDupes] as const,
    ["User-id duplicates", userDupes] as const,
  ]) {
    if (groups.length === 0) continue;
    console.log(`\n--- ${label} ---`);
    for (const g of groups) console.log(JSON.stringify(g, null, 2));
  }

  if (hashDupes.length === 0 && accountDupes.length === 0 && userDupes.length === 0) {
    console.log("\nNo cross-tenant identity conflicts found.");
  } else {
    console.log(
      "\nResolve via /admin/maintenance/social-connections (Layer 4) before merging.",
    );
  }
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
