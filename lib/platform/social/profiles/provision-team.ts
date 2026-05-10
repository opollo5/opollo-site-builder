import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// BSP-6 — per-profile bundle.social team provisioning.
//
// Same race-protection shape as lib/platform/social/bundle-social/provision.ts
// (BSP-2), but operating on platform_social_profiles.bundle_social_team_id
// instead of platform_companies.bundle_social_team_id.
//
//   1. In-process Promise dedup — module-level Map keyed by profileId.
//   2. Optimistic UPDATE WHERE bundle_social_team_id IS NULL — first
//      writer wins; loser re-reads.
//   3. UNIQUE partial index on bundle_social_team_id (migration 0118)
//      — defence-in-depth.
//
// Worst-case orphan: cross-process race → one bundle.social team is
// orphaned. Reconciled by scripts/bundlesocial-reconcile-orphans.ts
// (BSP-4), which already checks platform_social_profiles.bundle_social_team_id.
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<string>>();

export async function getOrCreateBundleSocialTeamForProfile(
  profileId: string,
): Promise<string> {
  const existing = inflight.get(profileId);
  if (existing) return existing;

  const promise = provisionImpl(profileId).finally(() => {
    inflight.delete(profileId);
  });
  inflight.set(profileId, promise);
  return promise;
}

async function provisionImpl(profileId: string): Promise<string> {
  const svc = getServiceRoleClient();

  const { data: row, error: readErr } = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id, name, company_id")
    .eq("id", profileId)
    .single();

  if (readErr) {
    throw new Error(`Failed to read profile ${profileId}: ${readErr.message}`);
  }
  if (!row) {
    throw new Error(`Profile ${profileId} not found.`);
  }

  const stored = row.bundle_social_team_id as string | null;
  if (stored) return stored;

  const client = getBundlesocialClient();
  if (!client) {
    throw new Error(
      "BUNDLE_SOCIAL_API is not configured — cannot provision a bundle.social team.",
    );
  }

  // Use the profile's name as the bundle.social team name. Append a short
  // company-id suffix so multiple companies can have profiles with the
  // same name (e.g., "Brand Social") without colliding visually in the
  // bundle.social dashboard.
  const teamName = `${row.name as string} (${(row.company_id as string).slice(0, 8)})`;

  let newTeamId: string;
  try {
    const team = await client.team.teamCreateTeam({
      requestBody: { name: teamName },
    });
    newTeamId = team.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.profile.provision.create_team_failed", {
      profile_id: profileId,
      err: msg,
    });
    throw new Error(`bundle.social team creation failed: ${msg}`);
  }

  await svc
    .from("platform_social_profiles")
    .update({ bundle_social_team_id: newTeamId })
    .eq("id", profileId)
    .is("bundle_social_team_id", null);

  const { data: confirmed, error: confirmErr } = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .eq("id", profileId)
    .single();

  if (confirmErr || !confirmed?.bundle_social_team_id) {
    throw new Error(
      `bundle_social_team_id missing after provision attempt: ${confirmErr?.message ?? "null value"}`,
    );
  }

  const storedId = confirmed.bundle_social_team_id as string;

  logger.info("bundlesocial.profile.provision.team_provisioned", {
    profile_id: profileId,
    team_id: storedId,
    race_winner: storedId !== newTeamId,
  });

  return storedId;
}

export function __resetInflightForTesting(): void {
  inflight.clear();
}
