import "server-only";

import type { PageMetricsRollup } from "../metrics-aggregation";
import { normaliseAgainstPercentiles } from "./percentile";
import type { ConversionComponentsPresent } from "./types";
import { DEFAULT_CONVERSION_COMPONENTS } from "./types";

// Conversion sub-score — addendum §2.2.3.
//
// Default weights:
//   conversion_rate     0.50 (higher is better)
//   cost_per_conversion 0.30 (lower is better)
//   revenue_per_visit   0.20 (higher is better)
//
// Where revenue isn't tracked (most B2B MSP cases — the spec's
// motivating example), the 0.20 weight redistributes to CR (0.65) and
// CPA (0.35). Decision Q1.6.1 from the addendum: redistribute to
// CR + CPA rather than alignment + behaviour. Documented in this
// slice's PR.
//
// `present` is read from opt_clients.conversion_components_present —
// staff toggle revenue tracking on per-client when ecommerce is wired
// up. CR and CPA are assumed always present (the scorer returns NULL
// when both are unavailable for the page even if "present" claims
// they should be).

const FULL_WEIGHTS = {
  conversion_rate: 0.5,
  cost_per_conversion: 0.3,
  revenue_per_visit: 0.2,
} as const;

const NO_REVENUE_WEIGHTS = {
  conversion_rate: 0.65,
  cost_per_conversion: 0.35,
  revenue_per_visit: 0,
} as const;

export type ConversionCohortRow = {
  conversion_rate?: number | null;
  cost_per_conversion?: number | null;
  revenue_per_visit?: number | null;
};

export type ConversionScoreResult = {
  score: number;
  components: {
    conversion_rate: number | null;
    cost_per_conversion: number | null;
    revenue_per_visit: number | null;
  };
  /** Effective weights applied (after revenue redistribution). */
  weights_applied: {
    conversion_rate: number;
    cost_per_conversion: number;
    revenue_per_visit: number;
  };
};

export function computeConversionSubscore(args: {
  rollup: PageMetricsRollup;
  cohort: ConversionCohortRow[];
  componentsPresent?: ConversionComponentsPresent;
  /** Page-level CPA (USD cents). Computed by the caller because
   * cost_per_conversion = spend / conversions, both rollup fields. */
  costPerConversionCents?: number;
  /** Page-level revenue per visit (USD cents). NULL when not tracked. */
  revenuePerVisitCents?: number;
}): ConversionScoreResult | null {
  const present = args.componentsPresent ?? DEFAULT_CONVERSION_COMPONENTS;
  const useFullWeights = present.revenue && (args.revenuePerVisitCents ?? null) != null;
  const weights = useFullWeights ? FULL_WEIGHTS : NO_REVENUE_WEIGHTS;

  const components = {
    conversion_rate: scoreComponent(
      args.rollup.conversion_rate > 0 ? args.rollup.conversion_rate : null,
      args.cohort.map((r) => r.conversion_rate ?? null),
      "higher_is_better",
    ),
    cost_per_conversion: scoreComponent(
      typeof args.costPerConversionCents === "number" &&
        args.costPerConversionCents > 0
        ? args.costPerConversionCents
        : null,
      args.cohort.map((r) => r.cost_per_conversion ?? null),
      "lower_is_better",
    ),
    revenue_per_visit: useFullWeights
      ? scoreComponent(
          typeof args.revenuePerVisitCents === "number" &&
            args.revenuePerVisitCents > 0
            ? args.revenuePerVisitCents
            : null,
          args.cohort.map((r) => r.revenue_per_visit ?? null),
          "higher_is_better",
        )
      : null,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(weights) as Array<
    [keyof typeof FULL_WEIGHTS, number]
  >) {
    if (weight === 0) continue;
    const componentValue = components[key];
    if (componentValue == null) continue;
    weightedSum += componentValue * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  const composite = Math.round(weightedSum / totalWeight);
  return {
    score: Math.max(0, Math.min(100, composite)),
    components,
    weights_applied: {
      conversion_rate: weights.conversion_rate,
      cost_per_conversion: weights.cost_per_conversion,
      revenue_per_visit: weights.revenue_per_visit,
    },
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

/** Helper for callers to compute CPA from the rollup. */
export function costPerConversionFromRollup(
  rollup: PageMetricsRollup,
): number | null {
  if (rollup.conversions <= 0 || rollup.spend_usd_cents <= 0) return null;
  return rollup.spend_usd_cents / rollup.conversions;
}
