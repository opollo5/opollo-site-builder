import type { StagedRolloutConfig } from "@/lib/optimiser/types";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 16 — Staged rollout threshold evaluator.
//
// Pure-logic decision engine (no DB, no network) — given a rollout's
// config snapshot + observed metrics + age, returns one of:
//
//   - 'rollback'  — at least one rollback threshold tripped. Caller
//                   reverts the page + transitions rollout to
//                   'auto_reverted'.
//   - 'promote'   — all floors met (sessions, conversions, time) AND
//                   no rollback threshold tripped. Caller promotes to
//                   100% traffic + transitions rollout to 'promoted'.
//   - 'wait'     — neither rollback nor promote triggered yet. Floors
//                   not met OR window not exceeded. Monitor checks
//                   again next tick.
//   - 'window_expired' — maximum_window_days has passed without
//                        floors being met. Caller promotes (with a
//                        warning logged) — better to ship than block
//                        forever on low-traffic pages.
//
// Rollback thresholds evaluated in order; the first trip wins. The
// returned `trips` array names every threshold that DID fail so the
// monitor can log them all even though only one drives the decision.
//
// Statistical significance: the cr_drop check requires p ≥ 0.90 per
// the spec. We approximate with a two-proportion z-test against the
// baseline conversion rate. The implementation is intentionally
// simple (normal-approximation, no continuity correction) — the
// surrounding floors (300 sessions / 10 conversions) keep us well
// inside the regime where the approximation is fine.
// ---------------------------------------------------------------------------

export type { StagedRolloutConfig };

export interface RolloutMetrics {
  sessions_new: number;
  conversions_new: number;
  bounces_new: number;
  errors_new: number;
  // Baseline (current production) over a comparable window.
  sessions_baseline: number;
  conversions_baseline: number;
  bounces_baseline: number;
}

export interface EvaluationInput {
  config: StagedRolloutConfig;
  metrics: RolloutMetrics;
  /** ms since the rollout started. */
  age_ms: number;
}

export type EvaluationDecision =
  | "rollback"
  | "promote"
  | "wait"
  | "window_expired";

export interface EvaluationResult {
  decision: EvaluationDecision;
  trips: string[];
  // Computed numbers the monitor logs to regression_check_results.
  observed: {
    cr_new: number;
    cr_baseline: number;
    cr_drop_pct: number;
    cr_drop_p_value: number | null;
    bounce_new: number;
    bounce_baseline: number;
    bounce_spike_pct: number;
    error_rate: number;
    floors_met: {
      sessions: boolean;
      conversions: boolean;
      time: boolean;
    };
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function evaluateRollout(input: EvaluationInput): EvaluationResult {
  const { config, metrics, age_ms } = input;

  const cr_new = ratio(metrics.conversions_new, metrics.sessions_new);
  const cr_baseline = ratio(metrics.conversions_baseline, metrics.sessions_baseline);
  const cr_drop_pct = relDiffPct(cr_baseline, cr_new); // positive = drop
  const cr_drop_p_value =
    metrics.sessions_new >= config.minimum_sessions &&
    metrics.conversions_new >= config.minimum_conversions
      ? twoProportionPValue(
          metrics.conversions_new,
          metrics.sessions_new,
          metrics.conversions_baseline,
          metrics.sessions_baseline,
        )
      : null;
  const bounce_new = ratio(metrics.bounces_new, metrics.sessions_new);
  const bounce_baseline = ratio(metrics.bounces_baseline, metrics.sessions_baseline);
  const bounce_spike_pct = relDiffPct(bounce_new, bounce_baseline) * -1; // higher bounce = positive spike
  const error_rate = ratio(metrics.errors_new, metrics.sessions_new);

  const floors = {
    sessions: metrics.sessions_new >= config.minimum_sessions,
    conversions: metrics.conversions_new >= config.minimum_conversions,
    time: age_ms >= config.minimum_time_hours * HOUR_MS,
  };
  const allFloorsMet = floors.sessions && floors.conversions && floors.time;

  const trips: string[] = [];

  // Error-rate is the most decisive — page is broken; revert immediately.
  if (error_rate > config.error_spike_rollback_rate) {
    trips.push(`error_rate ${pct(error_rate)} > ${pct(config.error_spike_rollback_rate)}`);
  }
  // Bounce spike — page UX regressed.
  if (bounce_spike_pct >= config.bounce_spike_rollback_pct / 100) {
    trips.push(`bounce_spike ${pct(bounce_spike_pct)} >= ${config.bounce_spike_rollback_pct}%`);
  }
  // CR drop — needs both magnitude AND statistical significance.
  if (
    cr_drop_pct >= config.cr_drop_rollback_pct / 100 &&
    cr_drop_p_value !== null &&
    1 - cr_drop_p_value >= config.cr_drop_significance
  ) {
    trips.push(
      `cr_drop ${pct(cr_drop_pct)} >= ${config.cr_drop_rollback_pct}% (p=${(1 - cr_drop_p_value).toFixed(2)} >= ${config.cr_drop_significance})`,
    );
  }

  const observed: EvaluationResult["observed"] = {
    cr_new,
    cr_baseline,
    cr_drop_pct,
    cr_drop_p_value,
    bounce_new,
    bounce_baseline,
    bounce_spike_pct,
    error_rate,
    floors_met: floors,
  };

  if (trips.length > 0) {
    return { decision: "rollback", trips, observed };
  }

  if (allFloorsMet) {
    return { decision: "promote", trips: [], observed };
  }

  if (age_ms >= config.maximum_window_days * DAY_MS) {
    return { decision: "window_expired", trips: [], observed };
  }

  return { decision: "wait", trips: [], observed };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

// (baseline - candidate) / baseline. Positive = candidate is worse.
function relDiffPct(baseline: number, candidate: number): number {
  if (baseline <= 0) return 0;
  return (baseline - candidate) / baseline;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

// Two-proportion z-test, normal-approximation. Returns p-value
// (one-sided: probability that candidate's true rate is at least as
// high as observed under H0 = "rates are equal"). Lower p = stronger
// evidence the difference is real.
function twoProportionPValue(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): number {
  if (n1 === 0 || n2 === 0) return 1;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pPool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return 1;
  const z = (p1 - p2) / se;
  // One-sided lower tail: probability we observed THIS LOW a
  // candidate rate or lower under H0.
  return normalCdf(z);
}

// Standard normal CDF via a rational approximation (Abramowitz &
// Stegun 26.2.17). Accurate to ~7e-8.
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}
