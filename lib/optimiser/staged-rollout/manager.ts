import "server-only";

import { logger } from "@/lib/logger";
import {
  DEFAULT_STAGED_ROLLOUT_CONFIG,
  type StagedRolloutConfig,
} from "@/lib/optimiser/types";
import { recordChangeLog } from "@/lib/optimiser/change-log";
import { getServiceRoleClient } from "@/lib/supabase";

import {
  evaluateRollout,
  type EvaluationResult,
  type RolloutMetrics,
} from "./evaluator";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 16 — Staged rollout state manager.
//
// Three responsibilities:
//
//   1. createRolloutForApply() — called from sync-proposal-status when
//      a brief_run linked to a proposal succeeds. Snapshots the
//      per-client staged_rollout_config (or the default) and inserts
//      an opt_staged_rollouts row in 'live' state.
//
//   2. listLiveRollouts() — pulls all rollouts in 'live' state for
//      the monitor cron to evaluate.
//
//   3. recordEvaluation() / transitionToTerminal() — applied by the
//      monitor cron after evaluating a rollout. Append-only writes to
//      regression_check_results; CAS-protected state transitions so
//      two concurrent monitor ticks don't double-flip.
// ---------------------------------------------------------------------------

export interface CreateRolloutInput {
  proposalId: string;
  clientId: string;
  pageId: string | null;
}

export interface CreateRolloutResult {
  ok: true;
  rollout_id: string;
}

export async function createRolloutForApply(
  input: CreateRolloutInput,
): Promise<CreateRolloutResult | { ok: false; error: { code: string; message: string } }> {
  const supabase = getServiceRoleClient();

  // Pull the client's config — fall back to the default when the
  // client row carries no override.
  const clientRes = await supabase
    .from("opt_clients")
    .select("staged_rollout_config")
    .eq("id", input.clientId)
    .maybeSingle();
  if (clientRes.error) {
    return {
      ok: false,
      error: {
        code: "CLIENT_LOOKUP_FAILED",
        message: clientRes.error.message,
      },
    };
  }

  const config: StagedRolloutConfig = {
    ...DEFAULT_STAGED_ROLLOUT_CONFIG,
    ...((clientRes.data?.staged_rollout_config as Partial<StagedRolloutConfig>) ?? {}),
  };

  const { data, error } = await supabase
    .from("opt_staged_rollouts")
    .insert({
      proposal_id: input.proposalId,
      client_id: input.clientId,
      page_id: input.pageId,
      config_snapshot: config,
      traffic_split_percent: config.initial_traffic_split_percent,
      current_state: "live",
    })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: {
        code: "ROLLOUT_INSERT_FAILED",
        message: error?.message ?? "no row returned",
      },
    };
  }

  await recordChangeLog({
    clientId: input.clientId,
    proposalId: input.proposalId,
    landingPageId: null,
    event: "staged_rollout_started",
    actorUserId: null,
    details: {
      rollout_id: data.id,
      traffic_split_percent: config.initial_traffic_split_percent,
      config_snapshot: config,
    },
  });

  return { ok: true, rollout_id: data.id as string };
}

export interface LiveRolloutRow {
  id: string;
  proposal_id: string;
  client_id: string;
  page_id: string | null;
  started_at: string;
  config_snapshot: StagedRolloutConfig;
  traffic_split_percent: number;
}

export async function listLiveRollouts(): Promise<LiveRolloutRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_staged_rollouts")
    .select(
      "id, proposal_id, client_id, page_id, started_at, config_snapshot, traffic_split_percent",
    )
    .eq("current_state", "live")
    .order("started_at", { ascending: true });
  if (error) {
    logger.error("staged-rollout: listLive failed", { err: error.message });
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    proposal_id: row.proposal_id as string,
    client_id: row.client_id as string,
    page_id: (row.page_id as string | null) ?? null,
    started_at: row.started_at as string,
    config_snapshot: row.config_snapshot as StagedRolloutConfig,
    traffic_split_percent: row.traffic_split_percent as number,
  }));
}

// Append a single evaluation to regression_check_results.
export async function recordEvaluation(
  rolloutId: string,
  evaluation: EvaluationResult,
  metrics: RolloutMetrics,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const entry = {
    evaluated_at: new Date().toISOString(),
    decision: evaluation.decision,
    trips: evaluation.trips,
    metrics,
    observed: evaluation.observed,
  };
  // Read-modify-write the JSONB array. Acceptable here — monitor
  // runs serially per rollout (one cron, one tick per row), no
  // concurrent appenders. If concurrency ever needed: switch to
  // jsonb_insert via raw SQL.
  const cur = await supabase
    .from("opt_staged_rollouts")
    .select("regression_check_results")
    .eq("id", rolloutId)
    .maybeSingle();
  if (cur.error || !cur.data) {
    logger.error("staged-rollout: recordEvaluation read failed", {
      rollout_id: rolloutId,
      err: cur.error?.message,
    });
    return;
  }
  const existing = (cur.data.regression_check_results as unknown[]) ?? [];
  const next = [...existing, entry];
  const upd = await supabase
    .from("opt_staged_rollouts")
    .update({
      regression_check_results: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rolloutId);
  if (upd.error) {
    logger.error("staged-rollout: recordEvaluation write failed", {
      rollout_id: rolloutId,
      err: upd.error.message,
    });
  }
}

export type RolloutTerminalState =
  | "promoted"
  | "auto_reverted"
  | "manually_promoted"
  | "failed";

export async function transitionToTerminal(
  rolloutId: string,
  state: RolloutTerminalState,
  endReason: string,
  endedBy: string | null = null,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("opt_staged_rollouts")
    .update({
      current_state: state,
      ended_at: new Date().toISOString(),
      end_reason: endReason,
      ended_by: endedBy,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rolloutId)
    .eq("current_state", "live"); // CAS — only flip if still live
  if (error) {
    logger.error("staged-rollout: transitionToTerminal failed", {
      rollout_id: rolloutId,
      state,
      err: error.message,
    });
  }
}

// Re-export the evaluator for convenience.
export { evaluateRollout };
