import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// BSP-2 — race-safe per-company bundle.social team provisioning.
//
// Three layers of race protection:
//
//   1. In-process Promise dedup (this file) — a module-level Map keyed by
//      companyId stores the in-flight provision promise. Concurrent calls
//      within the same Node.js process share the same Promise. This is the
//      primary mechanism for the common case (single Vercel function
//      instance fielding parallel requests).
//
//   2. Optimistic UPDATE WHERE bundle_social_team_id IS NULL — at most one
//      concurrent writer's UPDATE will land. The loser re-reads and returns
//      the winner's value. Catches cross-process races (two Vercel functions
//      racing on the same uncommitted row).
//
//   3. UNIQUE partial index on bundle_social_team_id (migration 0116) —
//      defence-in-depth: a duplicate write would error rather than silently
//      overwriting. Never fires in practice because (1) and (2) catch the
//      race first; if it ever does, that's a data-integrity signal.
//
// Worst-case orphan: if two processes both call teamCreateTeam before the
// loser re-reads, one bundle.social team becomes orphaned (empty team —
// harmless). The orphan-cleanup script (BSP-4) reconciles those.
//
// Callers that can't afford to throw should wrap in try/catch and fall
// back to a degraded path (503 RECEIVER_NOT_CONFIGURED).
// ---------------------------------------------------------------------------

// Module-level in-flight map. Keyed by companyId, value is the promise that
// resolves to the team id. Entry is removed in `finally` so a failed
// provision doesn't poison subsequent attempts.
const inflight = new Map<string, Promise<string>>();

export async function getOrCreateBundleSocialTeam(
  companyId: string,
): Promise<string> {
  // Layer 1: in-process dedup.
  const existing = inflight.get(companyId);
  if (existing) return existing;

  const promise = provisionImpl(companyId).finally(() => {
    inflight.delete(companyId);
  });
  inflight.set(companyId, promise);
  return promise;
}

async function provisionImpl(companyId: string): Promise<string> {
  const svc = getServiceRoleClient();

  // Fast path — row already has a team id.
  const { data: row, error: readErr } = await svc
    .from("platform_companies")
    .select("bundle_social_team_id, name")
    .eq("id", companyId)
    .single();

  if (readErr) {
    throw new Error(`Failed to read company ${companyId}: ${readErr.message}`);
  }
  if (!row) {
    throw new Error(`Company ${companyId} not found.`);
  }

  const stored = row.bundle_social_team_id as string | null;
  if (stored) return stored;

  // Slow path — provision a new bundle.social team.
  const client = getBundlesocialClient();
  if (!client) {
    throw new Error(
      "BUNDLE_SOCIAL_API is not configured — cannot provision a bundle.social team.",
    );
  }

  const teamName = (row.name as string | null) ?? `company-${companyId.slice(0, 8)}`;

  let newTeamId: string;
  try {
    const team = await client.team.teamCreateTeam({
      requestBody: { name: teamName },
    });
    newTeamId = team.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.provision.create_team_failed", {
      company_id: companyId,
      err: msg,
    });
    throw new Error(`bundle.social team creation failed: ${msg}`);
  }

  // Layer 2: optimistic UPDATE WHERE IS NULL — first writer wins.
  await svc
    .from("platform_companies")
    .update({ bundle_social_team_id: newTeamId })
    .eq("id", companyId)
    .is("bundle_social_team_id", null);

  // Re-read to confirm what's stored (us or the cross-process race winner).
  const { data: confirmed, error: confirmErr } = await svc
    .from("platform_companies")
    .select("bundle_social_team_id")
    .eq("id", companyId)
    .single();

  if (confirmErr || !confirmed?.bundle_social_team_id) {
    throw new Error(
      `bundle_social_team_id missing after provision attempt: ${confirmErr?.message ?? "null value"}`,
    );
  }

  const storedId = confirmed.bundle_social_team_id as string;

  logger.info("bundlesocial.provision.team_provisioned", {
    company_id: companyId,
    team_id: storedId,
    race_winner: storedId !== newTeamId,
  });

  return storedId;
}

// Test-only — clears the in-flight map between tests. Not exported from
// any barrel; consumed by integration tests via direct path import.
export function __resetInflightForTesting(): void {
  inflight.clear();
}
