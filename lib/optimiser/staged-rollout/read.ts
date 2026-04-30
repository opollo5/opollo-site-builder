import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  DEFAULT_STAGED_ROLLOUT_CONFIG,
  type StagedRolloutConfig,
} from "@/lib/optimiser/types";

// ---------------------------------------------------------------------------
// Read-only helpers for surfacing opt_staged_rollouts state in operator
// UI. The monitor cron and lifecycle writers live in manager.ts; this
// module only does pointed lookups for page detail views and similar
// review surfaces.
//
// The rollout row links to a brief_run-produced page_id (Site Builder)
// and a proposal_id (optimiser). It does NOT carry a direct
// landing_page_id reference. To surface "is there a rollout for this
// landing page", we walk through opt_proposals where the landing page
// matches and pick the most recent rollout.
// ---------------------------------------------------------------------------

export type RolloutCurrentState =
  | "live"
  | "auto_reverted"
  | "promoted"
  | "manually_promoted"
  | "failed";

export interface RolloutRow {
  id: string;
  proposal_id: string;
  client_id: string;
  page_id: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  config_snapshot: StagedRolloutConfig;
  traffic_split_percent: number;
  current_state: RolloutCurrentState;
  /** Most recent monitor evaluation entry — what the operator actually
   * cares about: which decision the monitor made + observed metrics. */
  latest_evaluation: {
    evaluated_at: string;
    decision: "rollback" | "promote" | "wait" | "window_expired";
    trips: string[];
    observed: Record<string, unknown>;
  } | null;
  evaluation_count: number;
}

/** Returns the most recent rollout row for a landing page (any state),
 * or null if no proposal on that page has produced a rollout yet. */
export async function getLatestRolloutForLandingPage(
  landingPageId: string,
): Promise<RolloutRow | null> {
  const supabase = getServiceRoleClient();
  const { data: proposals } = await supabase
    .from("opt_proposals")
    .select("id")
    .eq("landing_page_id", landingPageId)
    .is("deleted_at", null);
  const proposalIds = (proposals ?? [])
    .map((p) => p.id as string)
    .filter(Boolean);
  if (proposalIds.length === 0) return null;

  const { data } = await supabase
    .from("opt_staged_rollouts")
    .select(
      "id, proposal_id, client_id, page_id, started_at, ended_at, end_reason, config_snapshot, traffic_split_percent, current_state, regression_check_results",
    )
    .in("proposal_id", proposalIds)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const evaluations = Array.isArray(data.regression_check_results)
    ? (data.regression_check_results as Array<{
        evaluated_at: string;
        decision: "rollback" | "promote" | "wait" | "window_expired";
        trips?: string[];
        observed?: Record<string, unknown>;
      }>)
    : [];
  const latest = evaluations.length > 0
    ? evaluations[evaluations.length - 1]
    : null;

  return {
    id: data.id as string,
    proposal_id: data.proposal_id as string,
    client_id: data.client_id as string,
    page_id: (data.page_id as string | null) ?? null,
    started_at: data.started_at as string,
    ended_at: (data.ended_at as string | null) ?? null,
    end_reason: (data.end_reason as string | null) ?? null,
    config_snapshot: {
      ...DEFAULT_STAGED_ROLLOUT_CONFIG,
      ...((data.config_snapshot as Partial<StagedRolloutConfig>) ?? {}),
    },
    traffic_split_percent: data.traffic_split_percent as number,
    current_state: data.current_state as RolloutCurrentState,
    latest_evaluation: latest
      ? {
          evaluated_at: latest.evaluated_at,
          decision: latest.decision,
          trips: latest.trips ?? [],
          observed: latest.observed ?? {},
        }
      : null,
    evaluation_count: evaluations.length,
  };
}
