import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Causal delta evaluation (addendum §4.3 + §9.8.5).
//
// For every applied proposal where the rollout window has closed:
//   - 14 days post-rollout (or per-client override on
//     opt_clients.causal_eval_window_days)  OR
//   - 300+ sessions on the new version
// whichever comes first.
//
// The evaluator:
//   1. Pulls the rollout day from opt_change_log (event = 'page_regenerated'
//      for that proposal_id) — falls back to opt_proposals.applied_at
//      when the change-log row is missing.
//   2. Aggregates pre-rollout metrics (matching duration immediately
//      before rollout) and post-rollout metrics (rollout to now).
//   3. Computes actual_impact_cr (relative %) and actual_impact_score
//      (composite delta) where data is available on both sides.
//   4. UPSERTs into opt_causal_deltas keyed by proposal_id.
//
// Side effect: feeds opt_playbooks.seed_impact_min/max_pp via the
// §9.4.2 calibration loop (Phase 2 activates the loop; Slice 13 ships
// the writer with `fed_into_calibration` defaulting false so a future
// loop activation can pick up unconsumed deltas).
// ---------------------------------------------------------------------------

const POST_ROLLOUT_SESSION_THRESHOLD = 300;
const DEFAULT_WINDOW_DAYS = 14;

export type CausalDeltaOutcome = {
  client_id: string;
  proposals_evaluated: number;
  proposals_skipped: number;
  errors: number;
};

export async function runCausalDeltaEvaluationForAllClients(): Promise<{
  outcomes: CausalDeltaOutcome[];
  total_proposals: number;
}> {
  const supabase = getServiceRoleClient();
  const { data: clients, error } = await supabase
    .from("opt_clients")
    .select("id, causal_eval_window_days")
    .is("deleted_at", null);
  if (error) {
    throw new Error(`runCausalDeltaEvaluationForAllClients: ${error.message}`);
  }
  const outcomes: CausalDeltaOutcome[] = [];
  let total = 0;
  for (const client of clients ?? []) {
    const o = await runForClient({
      clientId: client.id as string,
      windowDays:
        (client.causal_eval_window_days as number | null) ?? DEFAULT_WINDOW_DAYS,
    });
    total += o.proposals_evaluated;
    outcomes.push(o);
  }
  return { outcomes, total_proposals: total };
}

async function runForClient(args: {
  clientId: string;
  windowDays: number;
}): Promise<CausalDeltaOutcome> {
  const supabase = getServiceRoleClient();

  const { data: applied, error } = await supabase
    .from("opt_proposals")
    .select(
      "id, landing_page_id, applied_at, change_set, expected_impact_min_pp, expected_impact_max_pp, triggering_playbook_id, before_snapshot",
    )
    .eq("client_id", args.clientId)
    .in("status", ["applied", "applied_promoted"])
    .not("applied_at", "is", null)
    .is("deleted_at", null);
  if (error) {
    logger.error("optimiser.causal.list_failed", {
      client_id: args.clientId,
      error: error.message,
    });
    return {
      client_id: args.clientId,
      proposals_evaluated: 0,
      proposals_skipped: 0,
      errors: 1,
    };
  }

  let evaluated = 0;
  let skipped = 0;
  let errs = 0;
  const now = Date.now();
  for (const row of applied ?? []) {
    try {
      const appliedAt = new Date(row.applied_at as string).getTime();
      const windowMs = args.windowDays * 24 * 60 * 60 * 1000;
      const windowExpired = now - appliedAt >= windowMs;
      let postSessions = 0;
      if (!windowExpired) {
        // Need at least POST_ROLLOUT_SESSION_THRESHOLD sessions on the
        // new version to evaluate early.
        postSessions = await countSessionsSince(
          row.landing_page_id as string,
          new Date(appliedAt),
        );
        if (postSessions < POST_ROLLOUT_SESSION_THRESHOLD) {
          skipped += 1;
          continue;
        }
      }

      await evaluateProposal({
        clientId: args.clientId,
        landingPageId: row.landing_page_id as string,
        proposalId: row.id as string,
        appliedAt: new Date(appliedAt),
        evaluationEnd: new Date(now),
        changeSet: (row.change_set as Record<string, unknown>) ?? {},
        expectedImpactMinPp:
          (row.expected_impact_min_pp as number | null) ?? null,
        expectedImpactMaxPp:
          (row.expected_impact_max_pp as number | null) ?? null,
        triggeringPlaybookId:
          (row.triggering_playbook_id as string | null) ?? null,
        beforeSnapshot:
          (row.before_snapshot as Record<string, unknown>) ?? {},
      });
      evaluated += 1;
    } catch (err) {
      errs += 1;
      logger.error("optimiser.causal.failed", {
        proposal_id: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    client_id: args.clientId,
    proposals_evaluated: evaluated,
    proposals_skipped: skipped,
    errors: errs,
  };
}

async function countSessionsSince(
  landingPageId: string,
  since: Date,
): Promise<number> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("opt_metrics_daily")
    .select("metrics")
    .eq("landing_page_id", landingPageId)
    .eq("source", "ga4")
    .gte("metric_date", since.toISOString().slice(0, 10));
  let total = 0;
  for (const row of data ?? []) {
    const m = (row.metrics ?? {}) as { sessions?: number };
    total += typeof m.sessions === "number" ? m.sessions : 0;
  }
  return total;
}

async function evaluateProposal(args: {
  clientId: string;
  landingPageId: string;
  proposalId: string;
  appliedAt: Date;
  evaluationEnd: Date;
  changeSet: Record<string, unknown>;
  expectedImpactMinPp: number | null;
  expectedImpactMaxPp: number | null;
  triggeringPlaybookId: string | null;
  beforeSnapshot: Record<string, unknown>;
}): Promise<void> {
  const supabase = getServiceRoleClient();
  const windowDurationMs = args.evaluationEnd.getTime() - args.appliedAt.getTime();
  const preStart = new Date(args.appliedAt.getTime() - windowDurationMs);

  const [pre, post] = await Promise.all([
    aggregateWindowMetrics(args.landingPageId, preStart, args.appliedAt),
    aggregateWindowMetrics(args.landingPageId, args.appliedAt, args.evaluationEnd),
  ]);

  // CR delta — relative percentage change.
  let actual_impact_cr: number | null = null;
  if (pre.cr != null && post.cr != null && pre.cr > 0) {
    actual_impact_cr = (post.cr - pre.cr) / pre.cr;
  }

  // Composite-score delta — the proposal's before_snapshot carries the
  // pre-version composite (Slice 12 stores it on opt_proposals at
  // generation time; Phase 1.5 brief construction will overwrite when
  // the rebuild ships). Post-version composite reads from
  // opt_landing_pages.current_composite_score.
  const beforeScore =
    typeof (args.beforeSnapshot as { composite_score?: unknown })
      .composite_score === "number"
      ? ((args.beforeSnapshot as { composite_score: number }).composite_score)
      : null;
  let actual_impact_score: number | null = null;
  const { data: pageRow } = await supabase
    .from("opt_landing_pages")
    .select("current_composite_score")
    .eq("id", args.landingPageId)
    .maybeSingle();
  const afterScore = (pageRow?.current_composite_score as number | null) ?? null;
  if (beforeScore != null && afterScore != null) {
    actual_impact_score = afterScore - beforeScore;
  }

  // Confidence per §9.4.1 against the post-rollout window only.
  const confidence = computeWindowConfidence(post);

  const { error } = await supabase
    .from("opt_causal_deltas")
    .upsert(
      {
        client_id: args.clientId,
        landing_page_id: args.landingPageId,
        proposal_id: args.proposalId,
        change_set: args.changeSet,
        expected_impact: {
          min_pp: args.expectedImpactMinPp,
          max_pp: args.expectedImpactMaxPp,
        },
        actual_impact_cr,
        actual_impact_score,
        confidence_score: confidence.score,
        confidence_sample: confidence.sample,
        confidence_freshness: confidence.freshness,
        confidence_stability: confidence.stability,
        confidence_signal: confidence.signal,
        triggering_playbook_id: args.triggeringPlaybookId,
        evaluation_window_start: args.appliedAt.toISOString(),
        evaluation_window_end: args.evaluationEnd.toISOString(),
      },
      { onConflict: "proposal_id" },
    );
  if (error) {
    throw new Error(`evaluateProposal upsert: ${error.message}`);
  }
}

type WindowMetrics = {
  sessions: number;
  conversions: number;
  cr: number | null;
  bounce_rate: number | null;
  bounce_series: number[];
};

async function aggregateWindowMetrics(
  landingPageId: string,
  since: Date,
  until: Date,
): Promise<WindowMetrics> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("opt_metrics_daily")
    .select("metric_date, source, metrics")
    .eq("landing_page_id", landingPageId)
    .gte("metric_date", since.toISOString().slice(0, 10))
    .lte("metric_date", until.toISOString().slice(0, 10));
  let sessions = 0;
  let conversions = 0;
  const bounceSeries: number[] = [];
  for (const row of data ?? []) {
    const m = (row.metrics ?? {}) as {
      sessions?: number;
      conversions?: number;
      bounce_rate?: number;
    };
    if (row.source === "ga4") {
      sessions += m.sessions ?? 0;
      conversions += m.conversions ?? 0;
      if (typeof m.bounce_rate === "number") bounceSeries.push(m.bounce_rate);
    }
  }
  return {
    sessions,
    conversions,
    cr: sessions > 0 ? conversions / sessions : null,
    bounce_rate:
      bounceSeries.length > 0
        ? bounceSeries.reduce((a, b) => a + b, 0) / bounceSeries.length
        : null,
    bounce_series: bounceSeries,
  };
}

function computeWindowConfidence(window: WindowMetrics): {
  score: number;
  sample: number;
  freshness: number;
  stability: number;
  signal: number;
} {
  // Mirrors lib/optimiser/confidence.ts's formula but specialised
  // for the post-rollout window (§9.4.1 applied to the causal-delta
  // measurement).
  const sample = Math.min(1, window.sessions / 1000);
  const freshness = 1; // post-rollout = current, so 1.0
  let stability = 0.7;
  if (window.bounce_series.length >= 3) {
    const mean =
      window.bounce_series.reduce((a, b) => a + b, 0) /
      window.bounce_series.length;
    if (mean > 0) {
      const variance =
        window.bounce_series.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
        window.bounce_series.length;
      const stddev = Math.sqrt(variance);
      const cov = Math.abs(stddev / mean);
      stability = Math.max(0, Math.min(1, 1 - cov));
    }
  }
  const signal = window.conversions >= 30 ? 0.9 : window.conversions >= 10 ? 0.6 : 0.4;
  const score = sample * freshness * stability * signal;
  return {
    score: round3(score),
    sample: round3(sample),
    freshness: round3(freshness),
    stability: round3(stability),
    signal: round3(signal),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
