#!/usr/bin/env -S npx tsx
/**
 * One-shot backfill: update display_name for social_connections rows where
 * is_personal_mode=false and external_account_id is a known org/page URN
 * but display_name is stale (personal-account name from OAuth, not the
 * channel name).
 *
 * Only touches rows that are healthy, not in personal mode, and have a
 * non-null external_account_id (i.e. a channel has been bound). For each
 * such row it fetches the current channel list from bundle.social and
 * matches on external_account_id to find the channel name.
 *
 * Idempotent — re-running only writes rows where the name differs.
 *
 * Usage:
 *   npx tsx scripts/backfill-channel-display-name.ts            # writes
 *   npx tsx scripts/backfill-channel-display-name.ts --dry-run  # no writes
 */

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Bundlesocial } from "bundlesocial";

config({ path: ".env.production.local" });
config({ path: ".env.local" });

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

// Map DB platform to bundle.social type string.
const PLATFORM_TO_BUNDLE: Record<string, string> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  gbp: "GOOGLE_BUSINESS",
};

async function main() {
  console.log(`[backfill-channel-display-name] dry-run=${dryRun}`);

  // Load rows: healthy, not personal mode, channel bound (external_account_id set).
  const { data: rows, error: fetchErr } = await supabase
    .from("social_connections")
    .select(
      "id, platform, bundle_social_account_id, display_name, external_account_id, profile_id",
    )
    .eq("status", "healthy")
    .eq("is_personal_mode", false)
    .not("external_account_id", "is", null)
    .in("platform", ["linkedin_personal", "linkedin_company", "facebook_page", "gbp"]);

  if (fetchErr) {
    console.error("Failed to query social_connections:", fetchErr.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("No rows to backfill.");
    return;
  }

  console.log(`Found ${rows.length} candidate rows.`);

  // For each row, look up the profile's bundle.social team, fetch channels,
  // find the matching channel by external_account_id, and update display_name.
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const bundleType = PLATFORM_TO_BUNDLE[row.platform as string];
    if (!bundleType) {
      console.log(`  [SKIP] ${row.id} — platform ${row.platform} not backfillable`);
      skipped++;
      continue;
    }

    // Resolve the bundle.social team for this profile.
    const { data: profile, error: profileErr } = await supabase
      .from("platform_social_profiles")
      .select("bundle_social_team_id")
      .eq("id", row.profile_id)
      .maybeSingle();

    if (profileErr || !profile?.bundle_social_team_id) {
      console.warn(`  [SKIP] ${row.id} — no team_id (profileErr=${profileErr?.message})`);
      skipped++;
      continue;
    }

    const teamId = profile.bundle_social_team_id as string;

    // Fetch channels from bundle.social.
    let channelName: string | null = null;
    try {
      const acct = await client.socialAccount.socialAccountGetByType({
        teamId,
        type: bundleType as "LINKEDIN" | "FACEBOOK" | "GOOGLE_BUSINESS",
      });

      // channels is at acct.channels (array of {id, name, ...})
      const channels = (acct as unknown as {
        channels?: Array<{ id: string; name: string | null }>;
      }).channels ?? [];

      const match = channels.find((ch) => ch.id === (row.external_account_id as string));
      if (match) {
        channelName = match.name ?? null;
      } else {
        console.warn(
          `  [WARN] ${row.id} — external_account_id ${row.external_account_id} not found in channels list (${channels.length} channels)`,
        );
      }
    } catch (sdkErr) {
      console.error(`  [ERROR] ${row.id} — SDK call failed:`, sdkErr);
      errors++;
      continue;
    }

    if (!channelName) {
      console.log(`  [SKIP] ${row.id} — could not resolve channel name`);
      skipped++;
      continue;
    }

    if (channelName === row.display_name) {
      console.log(`  [SKIP] ${row.id} — display_name already correct ("${channelName}")`);
      skipped++;
      continue;
    }

    console.log(
      `  [UPDATE] ${row.id} — "${row.display_name}" → "${channelName}" (${row.external_account_id})`,
    );

    if (!dryRun) {
      const { error: updErr } = await supabase
        .from("social_connections")
        .update({ display_name: channelName })
        .eq("id", row.id);

      if (updErr) {
        console.error(`    UPDATE failed: ${updErr.message}`);
        errors++;
        continue;
      }
    }

    updated++;
    // Brief pause to avoid hammering the bundle.social API.
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(
    `\nDone. updated=${updated} skipped=${skipped} errors=${errors}${dryRun ? " (dry-run — no writes)" : ""}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
