import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import { isPatternLibraryEnabled } from "./feature-flag";
import type { PatternConfidence, PatternRow } from "./types";

// ---------------------------------------------------------------------------
// Pattern-library priors reader for the Phase 3 Slice 23 proposal
// generator integration. Spec §11.2.1 says "patterns may be applied as
// proposals to clients with consent = true". §11.2 says cross-client
// patterns inform the expected_impact range — "past five CTA-move
// proposals for this client averaged +1.4% CR with high confidence."
//
// Slice 23 widens that to the cross-client surface: when a pattern row
// applies to the same playbook as the proposal being generated AND the
// receiving client has cross_client_learning_consent=true, the priors
// reader returns a blend recommendation:
//
//   - blended_min_pp / blended_max_pp = weighted blend of
//     playbook.seed_impact_min/max_pp (50%) and the pattern's
//     effect_pp_ci_low/high (50%) when confidence is high
//     (37.5/62.5 for moderate, 25/75 for low — the seed dominates
//     when the cross-client signal is weak).
//
// The blend keeps proposals grounded in the playbook's calibrated seed
// while pulling toward observed cross-client outcomes. When no
// matching pattern exists, the seed flows through unchanged.
//
// Hard gates:
//   1. isPatternLibraryEnabled()  — env flag
//   2. receiving client's cross_client_learning_consent must be true
//      (consent gates BOTH contribution AND application per §11.2.2)
// ---------------------------------------------------------------------------

const BLEND_WEIGHT_BY_CONFIDENCE: Record<PatternConfidence, number> = {
  high: 0.5,
  moderate: 0.375,
  low: 0.25,
};

export interface PriorsResult {
  /** TRUE when a relevant pattern was found and the blend was applied. */
  applied: boolean;
  /** Reason the priors were not applied — propagated to the
   * proposal's pattern_priors_applied JSON for transparency. */
  reason?:
    | "feature_flag_off"
    | "client_not_consenting"
    | "no_matching_pattern"
    | "client_lookup_failed";
  /** The pattern row used for the blend, when applied. */
  pattern: PatternRow | null;
  /** Blend weight applied to the pattern (0..1). 0 = seed only. */
  blend_weight: number;
  /** Output expected-impact range. When applied=false, equals the
   * input seed range so callers can write through unchanged. */
  expected_min_pp: number;
  expected_max_pp: number;
}

export async function applyPriorsToImpactRange(args: {
  clientId: string;
  playbookId: string | null;
  seedMinPp: number;
  seedMaxPp: number;
}): Promise<PriorsResult> {
  if (!isPatternLibraryEnabled()) {
    return {
      applied: false,
      reason: "feature_flag_off",
      pattern: null,
      blend_weight: 0,
      expected_min_pp: args.seedMinPp,
      expected_max_pp: args.seedMaxPp,
    };
  }

  const supabase = getServiceRoleClient();
  const { data: client, error: cErr } = await supabase
    .from("opt_clients")
    .select("id, cross_client_learning_consent")
    .eq("id", args.clientId)
    .is("deleted_at", null)
    .maybeSingle();
  if (cErr) {
    return {
      applied: false,
      reason: "client_lookup_failed",
      pattern: null,
      blend_weight: 0,
      expected_min_pp: args.seedMinPp,
      expected_max_pp: args.seedMaxPp,
    };
  }
  if (!client?.cross_client_learning_consent) {
    return {
      applied: false,
      reason: "client_not_consenting",
      pattern: null,
      blend_weight: 0,
      expected_min_pp: args.seedMinPp,
      expected_max_pp: args.seedMaxPp,
    };
  }

  if (!args.playbookId) {
    return {
      applied: false,
      reason: "no_matching_pattern",
      pattern: null,
      blend_weight: 0,
      expected_min_pp: args.seedMinPp,
      expected_max_pp: args.seedMaxPp,
    };
  }

  // Pick the most-trusted pattern row for the playbook. Order:
  // confidence (high > moderate > low) then sample_size_clients desc.
  const { data: pattern } = await supabase
    .from("opt_pattern_library")
    .select(
      "id, pattern_type, observation, variant_label, baseline_label, sample_size_pages, sample_size_ad_groups, sample_size_clients, sample_size_observations, effect_pp_mean, effect_pp_ci_low, effect_pp_ci_high, confidence, applies_to, triggering_playbook_id, last_extracted_at, created_at",
    )
    .eq("triggering_playbook_id", args.playbookId)
    .order("confidence", { ascending: false })
    .order("sample_size_clients", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!pattern) {
    return {
      applied: false,
      reason: "no_matching_pattern",
      pattern: null,
      blend_weight: 0,
      expected_min_pp: args.seedMinPp,
      expected_max_pp: args.seedMaxPp,
    };
  }

  const row = pattern as PatternRow;
  const w = BLEND_WEIGHT_BY_CONFIDENCE[row.confidence];
  const blendedMin =
    args.seedMinPp * (1 - w) + Number(row.effect_pp_ci_low) * w;
  const blendedMax =
    args.seedMaxPp * (1 - w) + Number(row.effect_pp_ci_high) * w;
  return {
    applied: true,
    pattern: row,
    blend_weight: w,
    expected_min_pp: round3(Math.min(blendedMin, blendedMax)),
    expected_max_pp: round3(Math.max(blendedMin, blendedMax)),
  };
}

/** Read all patterns relevant to a (client, playbook) pair so the
 * proposal review surface can show "past N proposals across X
 * consenting clients averaged +Y% CR". Returns [] when feature flag
 * off or client doesn't consent. */
export async function listRelevantPatterns(args: {
  clientId: string;
  playbookId: string | null;
}): Promise<PatternRow[]> {
  if (!isPatternLibraryEnabled() || !args.playbookId) return [];
  const supabase = getServiceRoleClient();
  const { data: client } = await supabase
    .from("opt_clients")
    .select("id, cross_client_learning_consent")
    .eq("id", args.clientId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!client?.cross_client_learning_consent) return [];
  const { data } = await supabase
    .from("opt_pattern_library")
    .select(
      "id, pattern_type, observation, variant_label, baseline_label, sample_size_pages, sample_size_ad_groups, sample_size_clients, sample_size_observations, effect_pp_mean, effect_pp_ci_low, effect_pp_ci_high, confidence, applies_to, triggering_playbook_id, last_extracted_at, created_at",
    )
    .eq("triggering_playbook_id", args.playbookId)
    .order("confidence", { ascending: false })
    .order("sample_size_clients", { ascending: false });
  return (data ?? []) as PatternRow[];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
