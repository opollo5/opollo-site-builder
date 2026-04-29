import "server-only";

import type { PageMetricsRollup } from "../metrics-aggregation";
import { normaliseAgainstPercentiles } from "./percentile";

// Behaviour sub-score — addendum §2.2.2.
//
// Aggregates four behaviour signals from Clarity + GA4 into a single
// 0–100 score, normalised against the client's active-pages 25th–75th
// percentile range. Comparing within the client's own page cohort is
// the right baseline — pages within an account should be comparable;
// cross-account benchmarks aren't.
//
// Weights (from Table 1):
//   bounce_rate          0.30 (lower is better)
//   avg_engagement_time  0.25 (higher is better)
//   scroll_depth         0.25 (higher is better)
//   cta_clicks_per_session 0.20 (higher is better)
//
// Where a component's input is unavailable (e.g. no Clarity data for
// scroll), that component's weight redistributes proportionally
// across the components that DO have data. The result is undefined
// (returns NULL) only when the cohort itself is too small (< 2 pages
// with that component) or when all four inputs are missing.

const COMPONENT_WEIGHTS = {
  bounce_rate: 0.3,
  avg_engagement_time_s: 0.25,
  avg_scroll_depth: 0.25,
  cta_clicks_per_session: 0.2,
} as const;

export type BehaviourCohortRow = {
  bounce_rate?: number | null;
  avg_engagement_time_s?: number | null;
  avg_scroll_depth?: number | null;
  cta_clicks_per_session?: number | null;
};

export type BehaviourScoreResult = {
  score: number;
  components: {
    bounce_rate: number | null;
    avg_engagement_time_s: number | null;
    avg_scroll_depth: number | null;
    cta_clicks_per_session: number | null;
  };
  components_used: number;
};

export function computeBehaviourSubscore(
  rollup: PageMetricsRollup,
  cohort: BehaviourCohortRow[],
  ctaClicksPerSession?: number,
): BehaviourScoreResult | null {
  const componentScores = {
    bounce_rate: scoreComponent(
      rollup.bounce_rate > 0 ? rollup.bounce_rate : null,
      cohort.map((r) => r.bounce_rate ?? null),
      "lower_is_better",
    ),
    avg_engagement_time_s: scoreComponent(
      rollup.avg_engagement_time_s > 0
        ? rollup.avg_engagement_time_s
        : null,
      cohort.map((r) => r.avg_engagement_time_s ?? null),
      "higher_is_better",
    ),
    avg_scroll_depth: scoreComponent(
      rollup.avg_scroll_depth > 0 ? rollup.avg_scroll_depth : null,
      cohort.map((r) => r.avg_scroll_depth ?? null),
      "higher_is_better",
    ),
    cta_clicks_per_session: scoreComponent(
      typeof ctaClicksPerSession === "number" && ctaClicksPerSession > 0
        ? ctaClicksPerSession
        : null,
      cohort.map((r) => r.cta_clicks_per_session ?? null),
      "higher_is_better",
    ),
  };

  // Sum up weighted contributions, redistributing across the
  // available components if some are missing.
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(COMPONENT_WEIGHTS) as Array<
    [keyof typeof COMPONENT_WEIGHTS, number]
  >) {
    const componentValue = componentScores[key];
    if (componentValue == null) continue;
    weightedSum += componentValue * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  const composite = Math.round(weightedSum / totalWeight);
  return {
    score: Math.max(0, Math.min(100, composite)),
    components: componentScores,
    components_used: Object.values(componentScores).filter((v) => v != null)
      .length,
  };
}

function scoreComponent(
  value: number | null,
  cohortValues: Array<number | null>,
  direction: "higher_is_better" | "lower_is_better",
): number | null {
  if (value == null) return null;
  const cohort = cohortValues.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  return normaliseAgainstPercentiles(value, cohort, direction);
}
