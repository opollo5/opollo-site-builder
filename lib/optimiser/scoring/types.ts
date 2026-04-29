// Shared types for the v1.6 composite-scoring system.

export type ScoreClassification =
  | "high_performer"
  | "optimisable"
  | "needs_attention";

export type ScoreWeights = {
  alignment: number;
  behaviour: number;
  conversion: number;
  technical: number;
};

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  alignment: 0.25,
  behaviour: 0.3,
  conversion: 0.3,
  technical: 0.15,
};

export type ConversionComponentsPresent = {
  cr: boolean;
  cpa: boolean;
  revenue: boolean;
};

export const DEFAULT_CONVERSION_COMPONENTS: ConversionComponentsPresent = {
  cr: true,
  cpa: true,
  revenue: false,
};

/** Per-page snapshot of the four sub-scores. NULL when the inputs
 * for that sub-score are unavailable; the composite calculator handles
 * redistribution. */
export type SubscoreBundle = {
  alignment: number | null;
  behaviour: number | null;
  conversion: number | null;
  technical: number | null;
};

export type CompositeResult = {
  composite_score: number;
  classification: ScoreClassification;
  /** Effective weights applied (after any §2.4 redistribution).
   * Always sums to 1.0. */
  weights_used: ScoreWeights;
  /** TRUE if §2.4 redistribution kicked in (conversion_n_a or any
   * sub-score input unavailable). */
  redistribution_applied: boolean;
  /** Per-sub-score weighted contribution (subscore × weight) for the
   * UI breakdown panel. */
  contributions: {
    alignment: number;
    behaviour: number;
    conversion: number;
    technical: number;
  };
};

/** Confidence per §9.4.1 — same shape as the proposal-level confidence. */
export type CompositeConfidence = {
  score: number;
  sample: number;
  freshness: number;
  stability: number;
  signal: number;
};
