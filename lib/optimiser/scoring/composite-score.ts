import { classify } from "./classify";
import {
  DEFAULT_SCORE_WEIGHTS,
  type CompositeResult,
  type ScoreWeights,
  type SubscoreBundle,
} from "./types";

// Composite-score assembler — addendum §2.1 + §2.4.
//
// Formula:
//   composite = (alignment × w_a) + (behaviour × w_b)
//             + (conversion × w_c) + (technical × w_t)
//
// Edge cases:
//   1. conversion_n_a = TRUE  → conversion's 0.30 weight redistributes
//      equally across alignment / behaviour / technical (so each grows
//      by 0.10).
//   2. Any sub-score input unavailable → that sub-score's weight
//      redistributes proportionally across the available sub-scores.
//      (Alignment is the canonical case: a brand-new page with no ad
//      group join has no alignment score; the 0.25 weight folds into
//      the rest.)
//   3. Both edge cases combine: if conversion_n_a and alignment is
//      unavailable, the remaining 0.55 weight (behaviour 0.30 +
//      technical 0.15 + the redistributed conversion 0.10 each) is
//      applied to behaviour + technical.
//
// `weights_used` in the result is always the post-redistribution
// weights — what was actually applied — so the persisted history
// row shows the truth, not the configured defaults.

export function computeCompositeScore(args: {
  subscores: SubscoreBundle;
  configuredWeights?: ScoreWeights;
  conversionNotApplicable?: boolean;
}): CompositeResult | null {
  const baseWeights = args.configuredWeights ?? DEFAULT_SCORE_WEIGHTS;
  let weights: ScoreWeights = { ...baseWeights };
  let redistribution_applied = false;

  // Step 1: conversion_n_a redistribution (§2.4).
  if (args.conversionNotApplicable) {
    const conversionWeight = weights.conversion;
    const splitTo = ["alignment", "behaviour", "technical"] as const;
    const each = conversionWeight / splitTo.length;
    weights = {
      alignment: weights.alignment + each,
      behaviour: weights.behaviour + each,
      conversion: 0,
      technical: weights.technical + each,
    };
    redistribution_applied = true;
  }

  // Step 2: redistribute weights of unavailable sub-scores
  // proportionally across the available ones.
  const availability: Record<keyof SubscoreBundle, boolean> = {
    alignment: args.subscores.alignment != null && weights.alignment > 0,
    behaviour: args.subscores.behaviour != null && weights.behaviour > 0,
    conversion:
      args.subscores.conversion != null && weights.conversion > 0,
    technical: args.subscores.technical != null && weights.technical > 0,
  };
  const totalAvailable = (Object.keys(availability) as Array<keyof SubscoreBundle>).reduce(
    (acc, k) => acc + (availability[k] ? weights[k] : 0),
    0,
  );
  if (totalAvailable <= 0) return null;
  if (totalAvailable < 1.0 - 1e-6) {
    // Some weight is going unused; rescale the available weights so
    // they sum to 1.
    const rescaler = 1 / totalAvailable;
    const rescaled: ScoreWeights = {
      alignment: availability.alignment ? weights.alignment * rescaler : 0,
      behaviour: availability.behaviour ? weights.behaviour * rescaler : 0,
      conversion: availability.conversion ? weights.conversion * rescaler : 0,
      technical: availability.technical ? weights.technical * rescaler : 0,
    };
    weights = rescaled;
    redistribution_applied = true;
  } else {
    // Drop weights for unavailable sub-scores to 0.
    weights = {
      alignment: availability.alignment ? weights.alignment : 0,
      behaviour: availability.behaviour ? weights.behaviour : 0,
      conversion: availability.conversion ? weights.conversion : 0,
      technical: availability.technical ? weights.technical : 0,
    };
  }

  const contributions = {
    alignment:
      availability.alignment && args.subscores.alignment != null
        ? args.subscores.alignment * weights.alignment
        : 0,
    behaviour:
      availability.behaviour && args.subscores.behaviour != null
        ? args.subscores.behaviour * weights.behaviour
        : 0,
    conversion:
      availability.conversion && args.subscores.conversion != null
        ? args.subscores.conversion * weights.conversion
        : 0,
    technical:
      availability.technical && args.subscores.technical != null
        ? args.subscores.technical * weights.technical
        : 0,
  };

  const composite = Math.round(
    contributions.alignment +
      contributions.behaviour +
      contributions.conversion +
      contributions.technical,
  );
  const clamped = Math.max(0, Math.min(100, composite));

  return {
    composite_score: clamped,
    classification: classify(clamped),
    weights_used: weights,
    redistribution_applied,
    contributions: {
      alignment: round1(contributions.alignment),
      behaviour: round1(contributions.behaviour),
      conversion: round1(contributions.conversion),
      technical: round1(contributions.technical),
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Identify the lowest-weighted-contribution sub-score for the
 * "What's dragging this score down" hint per addendum §4.1.
 * Returns NULL if the page is a high_performer (no dragging signal).
 */
export function lowestContribution(
  result: CompositeResult,
): keyof CompositeResult["contributions"] | null {
  if (result.classification === "high_performer") return null;
  const entries = Object.entries(result.contributions) as Array<
    [keyof CompositeResult["contributions"], number]
  >;
  // Filter out zero-weight (redistributed-out) entries.
  const eligible = entries.filter(([key]) => result.weights_used[key] > 0);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => a[1] - b[1]);
  return eligible[0][0];
}
