import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// BSP-1 — per-company bundle.social team provisioning.
//
// Idempotent: reads the stored team id first (fast path). Only calls the
// bundle.social API when the row has no team id yet (slow path). Race-safe:
// optimistic UPDATE WHERE bundle_social_team_id IS NULL means at most one
// concurrent provisioner writes; the loser re-reads and returns the winner's
// value. A bundle.social team created by the losing writer is orphaned (empty
// team — harmless).
//
// Callers that can't afford to throw should wrap in try/catch and fall back
// to a degraded path (503 RECEIVER_NOT_CONFIGURED).
// ---------------------------------------------------------------------------

export async function getOrCreateBundleSocialTeam(
  companyId: string,
): Promise<string> {
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

  const existing = row.bundle_social_team_id as string | null;
  if (existing) return existing;

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

  // Race-safe persist: UPDATE WHERE IS NULL so the first concurrent writer
  // wins. The UNIQUE partial index catches any duplicate writes.
  // We ignore the update error deliberately — the re-read below is truth.
  await svc
    .from("platform_companies")
    .update({ bundle_social_team_id: newTeamId })
    .eq("id", companyId)
    .is("bundle_social_team_id", null);

  // Re-read to confirm what's stored (us or the race winner).
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
