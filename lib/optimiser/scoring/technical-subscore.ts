import "server-only";

import type { PageMetricsRollup } from "../metrics-aggregation";

// Technical sub-score — addendum §2.2.4.
//
// Reads from PageSpeed Insights mobile data already ingested in v1.5.
// Mobile metrics are weighted because mobile is the dominant traffic
// source for paid landing pages. Each Core Web Vital maps to 0–100
// using Google's good / needs improvement / poor thresholds as the
// 100 / 50 / 0 anchors:
//
//   LCP (ms): 0–2500 good / 2500–4000 NI / >4000 poor
//   INP (ms): 0–200  good /  200–500  NI / >500  poor
//   CLS:      0–0.1  good /  0.1–0.25 NI / >0.25 poor
//   Mobile speed score: 0–100 already, taken as-is
//
// Weights (Table 3):
//   LCP                 0.35
//   INP                 0.25
//   CLS                 0.20
//   Mobile speed score  0.20
//
// When PSI hasn't measured a page yet, returns NULL so the composite
// can fall back to redistribution.

const COMPONENT_WEIGHTS = {
  lcp: 0.35,
  inp: 0.25,
  cls: 0.2,
  mobile_speed: 0.2,
} as const;

const LCP_GOOD_MS = 2500;
const LCP_POOR_MS = 4000;
const INP_GOOD_MS = 200;
const INP_POOR_MS = 500;
const CLS_GOOD = 0.1;
const CLS_POOR = 0.25;

export type TechnicalScoreResult = {
  score: number;
  components: {
    lcp: number | null;
    inp: number | null;
    cls: number | null;
    mobile_speed: number | null;
  };
  components_used: number;
};

export function computeTechnicalSubscore(
  rollup: PageMetricsRollup,
  /** Optional INP / CLS values from the most-recent PSI run. The base
   * rollup currently surfaces LCP + mobile_speed_score; INP and CLS are
   * read directly off the metrics row when present. */
  extra?: { inp_ms?: number | null; cls?: number | null },
): TechnicalScoreResult | null {
  const components = {
    lcp: scoreLcp(rollup.lcp_ms),
    inp: scoreInp(extra?.inp_ms ?? null),
    cls: scoreCls(extra?.cls ?? null),
    mobile_speed: scoreMobileSpeed(rollup.mobile_speed_score),
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(COMPONENT_WEIGHTS) as Array<
    [keyof typeof COMPONENT_WEIGHTS, number]
  >) {
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
    components_used: Object.values(components).filter((v) => v != null).length,
  };
}

function scoreLcp(ms: number | null): number | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return scoreThreshold(ms, LCP_GOOD_MS, LCP_POOR_MS, "lower_is_better");
}

function scoreInp(ms: number | null): number | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  return scoreThreshold(ms, INP_GOOD_MS, INP_POOR_MS, "lower_is_better");
}

function scoreCls(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return scoreThreshold(value, CLS_GOOD, CLS_POOR, "lower_is_better");
}

function scoreMobileSpeed(score: number | null): number | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.round(score);
}

/**
 * Map a metric to 0–100 against Google's good/NI/poor thresholds.
 * - lower_is_better: value ≤ good → 100, value ≥ poor → 0, linear in between.
 *   The midpoint (good ↔ poor centre) anchors to 50.
 * - higher_is_better: inverted.
 */
function scoreThreshold(
  value: number,
  good: number,
  poor: number,
  direction: "lower_is_better" | "higher_is_better",
): number {
  if (direction === "lower_is_better") {
    if (value <= good) return 100;
    if (value >= poor) return 0;
    // Linear interpolation between good (→ 100) and poor (→ 0).
    const t = (value - good) / (poor - good);
    return Math.round((1 - t) * 100);
  }
  if (value >= good) return 100;
  if (value <= poor) return 0;
  const t = (value - poor) / (good - poor);
  return Math.round(t * 100);
}
