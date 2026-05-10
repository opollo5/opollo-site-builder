import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// BSP-4 — orphan-team reconciliation.
//
// "Orphan" = a bundle.social team that exists on bundle.social's side but
// is not referenced by any of:
//   * platform_companies.bundle_social_team_id
//   * platform_social_profiles.bundle_social_team_id
//
// Orphans are created by:
//   1. The cross-process race in provisionImpl — two concurrent provisioners
//      both call teamCreateTeam; one wins the UPDATE WHERE IS NULL race;
//      the loser's team is orphaned. BSP-2 reduces this risk via in-process
//      dedup (Layer 1) but does not eliminate it across separate Vercel
//      function invocations.
//   2. Manual experimentation in the bundle.social dashboard.
//   3. Failed provisioning where teamCreate succeeded but the DB write
//      threw before the optimistic UPDATE landed.
//
// Reconciliation is offline tooling — no application code path calls into
// it. Run it from a developer machine against production credentials when
// orphan accounting drifts.
// ---------------------------------------------------------------------------

export type ReconcileTeam = {
  id: string;
  name: string;
  createdAt: string | null;
};

export type ReconcileReport = {
  totalRemote: number;
  totalTracked: number;
  orphans: ReconcileTeam[];
  // Teams referenced in our DB but missing from bundle.social — should be
  // empty in healthy state. Indicates manual deletion or DB drift.
  danglingRefs: string[];
};

// Pure function: given the list of bundle.social teams and the set of
// team ids tracked in our DB, returns the diff. Testable without DB or
// API access.
export function computeReconcileDiff(
  remoteTeams: ReadonlyArray<ReconcileTeam>,
  trackedTeamIds: ReadonlySet<string>,
): ReconcileReport {
  const orphans: ReconcileTeam[] = [];
  const remoteIds = new Set<string>();
  for (const t of remoteTeams) {
    remoteIds.add(t.id);
    if (!trackedTeamIds.has(t.id)) {
      orphans.push(t);
    }
  }
  const danglingRefs: string[] = [];
  for (const id of trackedTeamIds) {
    if (!remoteIds.has(id)) {
      danglingRefs.push(id);
    }
  }
  return {
    totalRemote: remoteTeams.length,
    totalTracked: trackedTeamIds.size,
    orphans,
    danglingRefs,
  };
}

// Reads every bundle_social_team_id we currently track from both
// platform_companies and platform_social_profiles. Returns a Set so
// the diff can run in O(1) per remote team.
export async function readTrackedTeamIds(): Promise<Set<string>> {
  const svc = getServiceRoleClient();

  const tracked = new Set<string>();

  const { data: companies, error: companiesErr } = await svc
    .from("platform_companies")
    .select("bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);
  if (companiesErr) {
    throw new Error(`readTrackedTeamIds.companies: ${companiesErr.message}`);
  }
  for (const row of companies ?? []) {
    const id = row.bundle_social_team_id as string | null;
    if (id) tracked.add(id);
  }

  const { data: profiles, error: profilesErr } = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);
  if (profilesErr) {
    throw new Error(`readTrackedTeamIds.profiles: ${profilesErr.message}`);
  }
  for (const row of profiles ?? []) {
    const id = row.bundle_social_team_id as string | null;
    if (id) tracked.add(id);
  }

  return tracked;
}

// Filter helper for delete safety: never delete teams created within
// the last `minAgeMs` milliseconds. Protects against races where a
// concurrent provisioner just created a team that hasn't been written
// to the DB yet.
export function filterDeleteSafeOrphans(
  orphans: ReadonlyArray<ReconcileTeam>,
  now: Date,
  minAgeMs: number,
): ReconcileTeam[] {
  const threshold = now.getTime() - minAgeMs;
  return orphans.filter((t) => {
    if (!t.createdAt) return false; // unknown age → unsafe.
    const created = new Date(t.createdAt).getTime();
    if (Number.isNaN(created)) return false;
    return created < threshold;
  });
}
