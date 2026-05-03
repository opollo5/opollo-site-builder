#!/usr/bin/env -S npx tsx
/**
 * scripts/bundlesocial-list-teams.ts
 *
 * One-shot helper: lists every team accessible to the current
 * BUNDLE_SOCIAL_API key. The team_id you want for
 * BUNDLE_SOCIAL_TEAM_ID is the `id` field of the team you intend
 * Opollo to publish through.
 *
 * Usage:
 *   BUNDLE_SOCIAL_API=sk_... npx tsx scripts/bundlesocial-list-teams.ts
 *
 * Or, if you've already added BUNDLE_SOCIAL_API to .env.local:
 *   npx tsx scripts/bundlesocial-list-teams.ts
 *
 * Output: one JSON object per team, plus a summary line.
 */

import { config } from "dotenv";
import { Bundlesocial } from "bundlesocial";

// Load .env.local if it exists so the script Just Works.
config({ path: ".env.local" });

async function main(): Promise<void> {
  const apiKey = process.env.BUNDLE_SOCIAL_API;
  if (!apiKey) {
    console.error(
      "BUNDLE_SOCIAL_API is not set. Either pass it inline:\n  BUNDLE_SOCIAL_API=sk_... npx tsx scripts/bundlesocial-list-teams.ts\nor add it to .env.local.",
    );
    process.exit(1);
  }

  const client = new Bundlesocial(apiKey);

  // Pull the org first so we can also surface the org id (sometimes
  // useful for webhook configuration in the dashboard).
  try {
    const org = (await client.organization.organizationGetOrganization()) as {
      id?: string;
      name?: string;
      teams?: Array<{ id: string; name: string }>;
    };
    if (org?.id) {
      console.log(
        JSON.stringify(
          { kind: "organization", id: org.id, name: org.name ?? null },
          null,
          2,
        ),
      );
    }
  } catch (err) {
    // Some accounts may not expose organization scope; fall through to
    // the team listing.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`organizationGetOrganization failed (continuing): ${message}`);
  }

  const teams = (await client.team.teamGetList()) as {
    items?: Array<{
      id: string;
      name: string;
      createdAt?: string;
      bots?: Array<unknown>;
    }>;
    total?: number;
  };

  const items = teams.items ?? [];
  if (items.length === 0) {
    console.log(
      "No teams found. Create one at https://app.bundle.social and re-run this script.",
    );
    return;
  }

  for (const t of items) {
    console.log(
      JSON.stringify(
        {
          kind: "team",
          id: t.id,
          name: t.name,
          bots: t.bots?.length ?? 0,
          createdAt: t.createdAt ?? null,
        },
        null,
        2,
      ),
    );
  }

  console.log(`\n${items.length} team(s) found.`);
  if (items.length === 1) {
    console.log(
      `\nSet BUNDLE_SOCIAL_TEAM_ID=${items[0]?.id} in Vercel + your local .env.local.`,
    );
  } else {
    console.log(
      "\nMultiple teams visible — pick the one you want Opollo to publish through and set BUNDLE_SOCIAL_TEAM_ID to its id.",
    );
  }
}

main().catch((err) => {
  console.error(
    "Failed to list teams:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
