// Phase 3 cross-client pattern library types.

export type PatternConfidence = "low" | "moderate" | "high";

export interface PatternRow {
  id: string;
  pattern_type: string;
  observation: string;
  variant_label: string;
  baseline_label: string;
  sample_size_pages: number;
  sample_size_ad_groups: number;
  sample_size_clients: number;
  sample_size_observations: number;
  effect_pp_mean: number;
  effect_pp_ci_low: number;
  effect_pp_ci_high: number;
  confidence: PatternConfidence;
  applies_to: Record<string, unknown> | null;
  triggering_playbook_id: string | null;
  last_extracted_at: string;
  created_at: string;
}

/** A single observation from a consenting client's A/B test outcome
 * or causal-delta record. The extractor groups these by
 * (pattern_type, variant_label, baseline_label, playbook_id) and
 * aggregates. */
export interface PatternObservation {
  pattern_type: string;
  variant_label: string;
  baseline_label: string;
  triggering_playbook_id: string | null;
  /** Source: which client / page / proposal / test contributed. The
   * extractor uses these to count distinct clients + pages but
   * NEVER persists them — anonymisation guarantee. */
  client_id: string;
  page_id: string;
  ad_group_id: string | null;
  proposal_id: string;
  /** Effect — variant CR minus baseline CR in percentage points.
   * Positive means the variant outperforms the baseline. */
  observed_effect_pp: number;
  /** Per-observation sample size, used to weight aggregation. */
  sample_size: number;
}
