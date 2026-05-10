#!/usr/bin/env ts-node
/**
 * BSP-1 backfill: provision a bundle.social team for every existing
 * platform_companies row that does not yet have bundle_social_team_id set.
 *
 * Usage (from repo root):
 *   npx ts-node --project tsconfig.scripts.json scripts/backfill-bundle-social-teams.ts
 *
 * Requires in env:
 *   BUNDLE_SOCIAL_API                   -- API key
 *   SUPABASE_SERVICE_ROLE_KEY           -- service role key
 *   NEXT_PUBLIC_SUPABASE_URL            -- Supabase URL
 */

import { createClient } from "@supabase/supabase-js";
import { Bundlesocial } from "bundlesocial";

async function main() {
  const apiKey = process.env.BUNDLE_SOCIAL_API;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!apiKey || !supabaseUrl || !serviceRoleKey) {
    console.error("Missing required env: BUNDLE_SOCIAL_API, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const client = new Bundlesocial(apiKey);
  const svc = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: companies, error } = await svc
    .from("platform_companies")
    .select("id, name, bundle_social_team_id")
    .is("bundle_social_team_id", null)
    .is("deleted_at", null);

  if (error) {
    console.error("Failed to list companies:", error.message);
    process.exit(1);
  }

  console.log(`Found ${companies?.length ?? 0} companies without a bundle.social team.`);

  for (const company of companies ?? []) {
    const id = company.id as string;
    const name = (company.name as string) ?? `company-${id.slice(0, 8)}`;
    console.log(`  Provisioning team for "${name}" (${id})...`);

    try {
      const team = await client.team.teamCreateTeam({ requestBody: { name } });
      const { error: writeErr } = await svc
        .from("platform_companies")
        .update({ bundle_social_team_id: team.id })
        .eq("id", id)
        .is("bundle_social_team_id", null);

      if (writeErr) {
        // Re-read to check if a concurrent writer won
        const { data: current } = await svc
          .from("platform_companies")
          .select("bundle_social_team_id")
          .eq("id", id)
          .single();
        console.log(`    Race: using existing team ${current?.bundle_social_team_id ?? "(unknown)"}`);
      } else {
        console.log(`    Done: team ${team.id}`);
      }
    } catch (err) {
      console.error(`    FAILED for ${id}:`, err instanceof Error ? err.message : String(err));
    }
  }

  console.log("Backfill complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});