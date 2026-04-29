import "server-only";

import type { PageMetricsRollup } from "./metrics-aggregation";

// ---------------------------------------------------------------------------
// Confidence score (spec §9.4.1).
//
// confidence_score = sample × freshness × stability × signal
//
//   sample_factor    = min(1, sessions / 1000)
//   freshness_factor = 1 if data ≤ 7 days old; linear decay to 0.5 at 14 days
//   stability_factor = 1 - coefficient_of_variation of the metric across the
//                       window. Capped at 1, floor at 0.
//   signal_factor    = magnitude of deviation from the playbook's trigger
//                       threshold. 0.4 just-over → 1.0 severely-over.
// ---------------------------------------------------------------------------

export type ConfidenceInputs = {
  rollup: PageMetricsRollup;
  /** Daily values of the headline metric for the playbook (e.g. bounce rate
   * for message_mismatch). Used to compute stability via CoV. */
  metric_series?: number[];
  /** TRUE if the playbook's trigger fired; needed for signal_factor.
   * Magnitude is the distance from threshold scaled to [0, 1]. */
  trigger_magnitude?: number;
};

export type ConfidenceResult = {
  score: number;
  sample: number;
  freshness: number;
  stability: number;
  signal: number;
};

export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const sample = Math.min(1, inputs.rollup.sessions / 1000);

  let freshness = 1;
  if (inputs.rollup.freshness_age_days != null) {
    const age = inputs.rollup.freshness_age_days;
    if (age <= 7) {
      freshness = 1;
    } else if (age >= 14) {
      freshness = 0.5;
    } else {
      // Linear decay from 1.0 at day 7 to 0.5 at day 14.
      freshness = 1 - ((age - 7) / 7) * 0.5;
    }
  } else {
    freshness = 0.5;
  }

  let stability = 1;
  if (inputs.metric_series && inputs.metric_series.length >= 3) {
    const cov = coefficientOfVariation(inputs.metric_series);
    stability = Math.max(0, Math.min(1, 1 - cov));
  } else {
    // No series → assume moderate stability so we don't over-promote
    // freshness alone.
    stability = 0.7;
  }

  let signal = 0.4;
  if (typeof inputs.trigger_magnitude === "number") {
    signal = Math.max(0, Math.min(1, inputs.trigger_magnitude));
  }

  const score = sample * freshness * stability * signal;
  return {
    score: round3(score),
    sample: round3(sample),
    freshness: round3(freshness),
    stability: round3(stability),
    signal: round3(signal),
  };
}

function coefficientOfVariation(series: number[]): number {
  const n = series.length;
  if (n === 0) return 1;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 1;
  const variance = series.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);
  return Math.abs(stddev / mean);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
