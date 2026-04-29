import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { recordChangeLog } from "../change-log";
import type { TestRow, VariantRow } from "../variants/types";
import {
  computeWinnerProbability,
  type BayesianResult,
  type VariantOutcome,
} from "./bayesian";

// ---------------------------------------------------------------------------
// A/B winner-detection monitor (Slice 19).
//
// Hourly cron iterates every opt_tests row with status='running'. For
// each, it pulls fresh GA4 metrics for both variants, computes the
// Bayesian posterior winner probability, and:
//
//   - If probability_b_better >= 0.95 → flip status to 'winner_b',
//     mark variant B 'active' (it stays serving 100%), variant A
//     'superseded'. Promote downstream effects (per-client memory,
//     playbook calibration).
//   - If probability_a_better >= 0.95 → 'winner_a', vice versa.
//   - If neither side has crossed AND the test is older than the
//     maximum window (7 days) → 'inconclusive', stop the test
//     gracefully.
//   - Otherwise persist the latest probabilities + sessions snapshot
//     and continue.
//
// Minimum-sample floors per §12.3:
//   - Both variants must have ≥ 100 sessions
//   - Both variants must have ≥ 10 conversions
// Below these the monitor records the latest snapshot but does not
// evaluate the winner probability — it just waits for more data.
//
// The monitor also expires tests that have been running longer than
// the §12.3 max window (7 days default; per-client overridable on
// opt_clients.staged_rollout_config.maximum_window_days — Phase 2
// reuses the same field as staged rollouts).
// ---------------------------------------------------------------------------

const WINNER_THRESHOLD = 0.95;
const DEFAULT_MAX_WINDOW_DAYS = 7;

export interface MonitorOutcome {
  test_id: string;
  status_before: string;
  status_after: string;
  probability_a: number | null;
  probability_b: number | null;
  reason: string;
}

export async function runAbMonitorTick(): Promise<{
  outcomes: MonitorOutcome[];
  total_running: number;
}> {
  const supabase = getServiceRoleClient();
  const { data: tests, error } = await supabase
    .from("opt_tests")
    .select(
      "id, client_id, landing_page_id, source_proposal_id, variant_a_id, variant_b_id, traffic_split_percent, status, min_sessions, min_conversions, winner_probability_a, winner_probability_b, last_metrics_snapshot, last_evaluated_at, started_at, ended_at, ended_reason, created_at, updated_at",
    )
    .eq("status", "running");
  if (error) {
    throw new Error(`runAbMonitorTick: ${error.message}`);
  }

  const outcomes: MonitorOutcome[] = [];
  for (const test of tests ?? []) {
    try {
      const outcome = await evaluateTest(test as TestRow);
      outcomes.push(outcome);
    } catch (err) {
      logger.error("optimiser.ab.monitor.failed", {
        test_id: test.id,
        error: err instanceof Error ? err.message : String(err),
      });
      outcomes.push({
        test_id: test.id as string,
        status_before: "running",
        status_after: "running",
        probability_a: null,
        probability_b: null,
        reason: `error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return { outcomes, total_running: (tests ?? []).length };
}

async function evaluateTest(test: TestRow): Promise<MonitorOutcome> {
  const supabase = getServiceRoleClient();

  // Pull both variants so we know what URL paths to read metrics for.
  const { data: variants } = await supabase
    .from("opt_variants")
    .select(
      "id, client_id, landing_page_id, source_proposal_id, variant_label, brief_id, brief_run_id, page_version, change_set, generation_notes, status, generated_at, failed_reason, created_at, updated_at, created_by",
    )
    .in("id", [test.variant_a_id, test.variant_b_id]);
  if (!variants || variants.length !== 2) {
    return {
      test_id: test.id,
      status_before: test.status,
      status_after: test.status,
      probability_a: null,
      probability_b: null,
      reason: "variants not found",
    };
  }
  const variantA = variants.find((v) => v.id === test.variant_a_id) as VariantRow;
  const variantB = variants.find((v) => v.id === test.variant_b_id) as VariantRow;

  const outcomeA = await fetchVariantMetrics({
    landingPageId: test.landing_page_id,
    label: "A",
    since: test.started_at,
  });
  const outcomeB = await fetchVariantMetrics({
    landingPageId: test.landing_page_id,
    label: "B",
    since: test.started_at,
  });

  const snapshot = {
    a: outcomeA,
    b: outcomeB,
    evaluated_at: new Date().toISOString(),
  };

  // Maximum window check — per-client override or default 7 days.
  if (test.started_at) {
    const startedMs = new Date(test.started_at).getTime();
    const ageDays = (Date.now() - startedMs) / (24 * 60 * 60 * 1000);
    const maxDays = await getMaxWindowDays(test.client_id);
    if (ageDays > maxDays) {
      // Pick the higher-mean variant if probabilities never crossed
      // 0.95; mark inconclusive on tie.
      let pA: number | null = null;
      let pB: number | null = null;
      let bayesian: BayesianResult | null = null;
      if (canEvaluate(outcomeA, outcomeB, test.min_sessions, test.min_conversions)) {
        bayesian = computeWinnerProbability(outcomeA, outcomeB);
        pA = bayesian.probability_a_better;
        pB = bayesian.probability_b_better;
      }
      const winner =
        bayesian && bayesian.posterior_mean_b > bayesian.posterior_mean_a + 0.001
          ? "b"
          : bayesian && bayesian.posterior_mean_a > bayesian.posterior_mean_b + 0.001
            ? "a"
            : null;
      const newStatus =
        winner === "a"
          ? "winner_a"
          : winner === "b"
            ? "winner_b"
            : "inconclusive";
      await endTest({
        test,
        bayesian,
        snapshot,
        endedReason:
          winner === null
            ? "max_window_reached:inconclusive"
            : `max_window_reached:winner_${winner}`,
        newStatus,
        winningVariant: winner === "a" ? variantA : winner === "b" ? variantB : null,
        losingVariant: winner === "a" ? variantB : winner === "b" ? variantA : null,
      });
      return {
        test_id: test.id,
        status_before: test.status,
        status_after: newStatus,
        probability_a: pA,
        probability_b: pB,
        reason:
          winner == null
            ? "max_window_reached:inconclusive"
            : `max_window_reached:winner_${winner}`,
      };
    }
  }

  // Floors not met — record snapshot, no evaluation.
  if (!canEvaluate(outcomeA, outcomeB, test.min_sessions, test.min_conversions)) {
    await supabase
      .from("opt_tests")
      .update({
        last_metrics_snapshot: snapshot,
        last_evaluated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", test.id);
    return {
      test_id: test.id,
      status_before: test.status,
      status_after: test.status,
      probability_a: null,
      probability_b: null,
      reason: `floors_not_met (sessions a=${outcomeA.sessions} b=${outcomeB.sessions} conversions a=${outcomeA.conversions} b=${outcomeB.conversions})`,
    };
  }

  const bayesian = computeWinnerProbability(outcomeA, outcomeB);
  if (bayesian.probability_b_better >= WINNER_THRESHOLD) {
    await endTest({
      test,
      bayesian,
      snapshot,
      endedReason: "winner_b_threshold",
      newStatus: "winner_b",
      winningVariant: variantB,
      losingVariant: variantA,
    });
    return {
      test_id: test.id,
      status_before: test.status,
      status_after: "winner_b",
      probability_a: bayesian.probability_a_better,
      probability_b: bayesian.probability_b_better,
      reason: "winner_b_threshold",
    };
  }
  if (bayesian.probability_a_better >= WINNER_THRESHOLD) {
    await endTest({
      test,
      bayesian,
      snapshot,
      endedReason: "winner_a_threshold",
      newStatus: "winner_a",
      winningVariant: variantA,
      losingVariant: variantB,
    });
    return {
      test_id: test.id,
      status_before: test.status,
      status_after: "winner_a",
      probability_a: bayesian.probability_a_better,
      probability_b: bayesian.probability_b_better,
      reason: "winner_a_threshold",
    };
  }

  // Neither threshold crossed — persist probabilities + snapshot, continue.
  await supabase
    .from("opt_tests")
    .update({
      winner_probability_a: bayesian.probability_a_better,
      winner_probability_b: bayesian.probability_b_better,
      last_metrics_snapshot: snapshot,
      last_evaluated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", test.id);
  return {
    test_id: test.id,
    status_before: test.status,
    status_after: test.status,
    probability_a: bayesian.probability_a_better,
    probability_b: bayesian.probability_b_better,
    reason: "still_running",
  };
}

function canEvaluate(
  a: VariantOutcome,
  b: VariantOutcome,
  minSessions: number,
  minConversions: number,
): boolean {
  return (
    a.sessions >= minSessions &&
    b.sessions >= minSessions &&
    a.conversions >= minConversions &&
    b.conversions >= minConversions
  );
}

async function fetchVariantMetrics(args: {
  landingPageId: string;
  label: "A" | "B";
  since: string | null;
}): Promise<VariantOutcome> {
  const supabase = getServiceRoleClient();
  // Phase 2 reads dimensioned data via opt_metrics_daily — GA4 syncs
  // store rows with dimension_key='opt_v' / dimension_value='A'|'B'
  // when the page-detail snippet emits ?opt_v=A|B. The Slice 18
  // traffic-split snippet sets the URL param; the GA4 sync (Phase 1)
  // reads it as a dimension. If the GA4 sync hasn't been extended to
  // read the opt_v dimension yet, this function returns 0/0 — the
  // monitor handles that gracefully by skipping evaluation until
  // floors are met.
  const since = args.since ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data } = await supabase
    .from("opt_metrics_daily")
    .select("metrics")
    .eq("landing_page_id", args.landingPageId)
    .eq("source", "ga4")
    .eq("dimension_key", "opt_v")
    .eq("dimension_value", args.label)
    .gte("metric_date", since.slice(0, 10));
  let sessions = 0;
  let conversions = 0;
  for (const row of data ?? []) {
    const m = (row.metrics ?? {}) as { sessions?: number; conversions?: number };
    sessions += m.sessions ?? 0;
    conversions += m.conversions ?? 0;
  }
  return { sessions, conversions };
}

async function getMaxWindowDays(clientId: string): Promise<number> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("opt_clients")
    .select("staged_rollout_config")
    .eq("id", clientId)
    .maybeSingle();
  const cfg = (data?.staged_rollout_config ?? {}) as {
    maximum_window_days?: number;
  };
  return cfg.maximum_window_days ?? DEFAULT_MAX_WINDOW_DAYS;
}

interface EndTestArgs {
  test: TestRow;
  bayesian: BayesianResult | null;
  snapshot: Record<string, unknown>;
  endedReason: string;
  newStatus: "winner_a" | "winner_b" | "inconclusive";
  winningVariant: VariantRow | null;
  losingVariant: VariantRow | null;
}

async function endTest(args: EndTestArgs): Promise<void> {
  const supabase = getServiceRoleClient();
  const nowIso = new Date().toISOString();

  // 1. Flip the test row.
  const { error: testErr } = await supabase
    .from("opt_tests")
    .update({
      status: args.newStatus,
      winner_probability_a: args.bayesian?.probability_a_better ?? null,
      winner_probability_b: args.bayesian?.probability_b_better ?? null,
      last_metrics_snapshot: args.snapshot,
      last_evaluated_at: nowIso,
      ended_at: nowIso,
      ended_reason: args.endedReason,
      updated_at: nowIso,
    })
    .eq("id", args.test.id);
  if (testErr) {
    logger.error("optimiser.ab.end_test.update_failed", {
      test_id: args.test.id,
      error: testErr.message,
    });
    return;
  }

  // 2. Mark winning variant 'active' (already is) and losing variant
  //    'superseded'. Inconclusive: leave both as 'active' so traffic
  //    keeps flowing under whichever variant the URL points to;
  //    operator can manually intervene.
  if (args.winningVariant && args.losingVariant) {
    await supabase
      .from("opt_variants")
      .update({ status: "superseded", updated_at: nowIso })
      .eq("id", args.losingVariant.id);
    await supabase
      .from("opt_variants")
      .update({ status: "active", updated_at: nowIso })
      .eq("id", args.winningVariant.id);
  }

  // 3. opt_change_log row — audit trail.
  await recordChangeLog({
    clientId: args.test.client_id,
    proposalId: args.test.source_proposal_id,
    landingPageId: args.test.landing_page_id,
    event: args.newStatus === "inconclusive" ? "ab_test_inconclusive" : "ab_winner_promoted",
    details: {
      test_id: args.test.id,
      winner: args.winningVariant?.variant_label ?? null,
      probability_a: args.bayesian?.probability_a_better ?? null,
      probability_b: args.bayesian?.probability_b_better ?? null,
      ended_reason: args.endedReason,
      snapshot: args.snapshot,
    },
  });

  // 4. Per-client memory: record the winning structural pattern so
  //    future proposals for this client bias toward similar layouts
  //    per §11.1 winning_variants.
  if (args.winningVariant) {
    await persistWinningVariantToMemory({
      clientId: args.test.client_id,
      proposal_id: args.test.source_proposal_id,
      variant: args.winningVariant,
      bayesian: args.bayesian,
    });
  }

  // 5. Recalibrate the triggering playbook's seed_impact_range via the
  //    §9.4.2 calibration loop — only when we have a clear winner +
  //    an observed CR delta to ground the calibration.
  if (
    args.winningVariant &&
    args.bayesian &&
    args.newStatus !== "inconclusive"
  ) {
    await recalibratePlaybook({
      proposalId: args.test.source_proposal_id,
      bayesian: args.bayesian,
      winnerLabel: args.winningVariant.variant_label,
    });
  }
}

async function persistWinningVariantToMemory(args: {
  clientId: string;
  proposal_id: string;
  variant: VariantRow;
  bayesian: BayesianResult | null;
}): Promise<void> {
  const supabase = getServiceRoleClient();
  // Look up the source proposal's playbook to key the memory entry.
  const { data: proposal } = await supabase
    .from("opt_proposals")
    .select("triggering_playbook_id")
    .eq("id", args.proposal_id)
    .maybeSingle();
  const playbookId =
    (proposal?.triggering_playbook_id as string | null) ?? "(unknown)";
  const key = `${playbookId}:landing:${args.variant.variant_label}`;

  const observed_cr =
    args.bayesian == null
      ? null
      : args.variant.variant_label === "B"
        ? args.bayesian.posterior_mean_b
        : args.bayesian.posterior_mean_a;
  const lift_pp =
    args.bayesian == null
      ? null
      : (args.bayesian.posterior_mean_b - args.bayesian.posterior_mean_a) *
        (args.variant.variant_label === "B" ? 1 : -1);

  // Idempotent UPSERT on (client, type, key) — bumps count when the
  // same playbook+page-type+variant wins repeatedly.
  const { data: existing } = await supabase
    .from("opt_client_memory")
    .select("id, count")
    .eq("client_id", args.clientId)
    .eq("memory_type", "winning_variant")
    .eq("key", key)
    .maybeSingle();
  const nextCount = ((existing?.count as number | undefined) ?? 0) + 1;
  if (existing) {
    await supabase
      .from("opt_client_memory")
      .update({
        count: nextCount,
        payload: {
          playbook_id: playbookId,
          page_type: "landing",
          variant_label: args.variant.variant_label,
          last_winner_at: new Date().toISOString(),
          last_change_set: args.variant.change_set,
          last_generation_notes: args.variant.generation_notes,
          last_observed_cr: observed_cr,
          last_lift_pp: lift_pp,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id as string);
  } else {
    await supabase.from("opt_client_memory").insert({
      client_id: args.clientId,
      memory_type: "winning_variant",
      key,
      count: 1,
      payload: {
        playbook_id: playbookId,
        page_type: "landing",
        variant_label: args.variant.variant_label,
        last_winner_at: new Date().toISOString(),
        last_change_set: args.variant.change_set,
        last_generation_notes: args.variant.generation_notes,
        last_observed_cr: observed_cr,
        last_lift_pp: lift_pp,
      },
    });
  }
}

async function recalibratePlaybook(args: {
  proposalId: string;
  bayesian: BayesianResult;
  winnerLabel: "A" | "B" | "C" | "D";
}): Promise<void> {
  const supabase = getServiceRoleClient();
  const { data: proposal } = await supabase
    .from("opt_proposals")
    .select("triggering_playbook_id")
    .eq("id", args.proposalId)
    .maybeSingle();
  const playbookId = proposal?.triggering_playbook_id as string | null;
  if (!playbookId) return;

  const { data: playbook } = await supabase
    .from("opt_playbooks")
    .select("id, seed_impact_min_pp, seed_impact_max_pp")
    .eq("id", playbookId)
    .maybeSingle();
  if (!playbook) return;

  // §9.4.2 weighted-average calibration: 30% seed + 70% observed once
  // we have ≥ 1 test outcome. The full §9.4.2 rule decays the seed
  // weight further after 30 outcomes; Phase 2 ships the first decay
  // step, future calibration will refine.
  const observedLiftPp =
    (args.bayesian.posterior_mean_b - args.bayesian.posterior_mean_a) * 100;
  const observedLiftSigned =
    args.winnerLabel === "B" ? observedLiftPp : -observedLiftPp;
  // The observed lift is a single number; the seed range is min/max.
  // Treat the observed midpoint of the post-rollout CR uplift as the
  // anchor and tighten min/max around it by 30/70 weighting.
  const seedMid =
    (Number(playbook.seed_impact_min_pp) + Number(playbook.seed_impact_max_pp)) /
    2;
  const newMid = 0.3 * seedMid + 0.7 * observedLiftSigned;
  const halfWidth =
    Math.max(
      0.5,
      (Number(playbook.seed_impact_max_pp) -
        Number(playbook.seed_impact_min_pp)) /
        2,
    ) * 0.7; // tighten 30%
  const newMin = Math.max(0, Math.round((newMid - halfWidth) * 1000) / 1000);
  const newMax = Math.max(
    newMin,
    Math.round((newMid + halfWidth) * 1000) / 1000,
  );

  await supabase.from("opt_playbook_calibration").insert({
    playbook_id: playbookId,
    source_test_id: null, // Phase 2 placeholder; could carry test.id in future
    observed_uplift_pp: Math.round(observedLiftSigned * 1000) / 1000,
    observed_sample_size:
      args.bayesian.sessions_a + args.bayesian.sessions_b,
    observed_significance:
      Math.max(args.bayesian.probability_a_better, args.bayesian.probability_b_better),
    seed_min_before_pp: Number(playbook.seed_impact_min_pp),
    seed_max_before_pp: Number(playbook.seed_impact_max_pp),
    seed_min_after_pp: newMin,
    seed_max_after_pp: newMax,
    reason: "observed",
    notes: `A/B winner=${args.winnerLabel}, observed lift ${observedLiftSigned.toFixed(2)}pp; weighted average against seed midpoint ${seedMid.toFixed(2)}pp.`,
  });

  await supabase
    .from("opt_playbooks")
    .update({
      seed_impact_min_pp: newMin,
      seed_impact_max_pp: newMax,
      updated_at: new Date().toISOString(),
    })
    .eq("id", playbookId);
}
