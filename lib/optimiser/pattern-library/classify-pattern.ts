// Pattern classification for the Phase 3 extractor.
//
// Given a causal-delta or A/B winning-variant record, derive the
// (pattern_type, variant_label, baseline_label) tuple that describes
// the structural change being measured. The classifier inspects the
// proposal's change_set + the playbook id — entirely structural, no
// content / copy / brand strings touched.
//
// New pattern types are added by extending the dispatch below; the
// schema-level `pattern_type` is free-text so additions are
// migration-free.

export interface PatternClassification {
  pattern_type: string;
  variant_label: string;
  baseline_label: string;
}

const TWIST_TO_VARIANT: Record<string, string> = {
  centred_hero_with_long_form: "centred_hero",
  trust_first_above_offer: "trust_first",
  two_step_form_with_progress_indicator: "two_step_form",
};

/** Classify a winning-variant outcome by reading the structural marker
 * the variant generator wrote into change_set._variant_b_twist (Slice
 * 18 deterministic fallback) or by inferring from the playbook id. */
export function classifyVariantOutcome(args: {
  change_set: Record<string, unknown>;
  playbook_id: string | null;
}): PatternClassification | null {
  const twist = (args.change_set as { _variant_b_twist?: unknown })
    ._variant_b_twist;
  if (typeof twist === "string" && twist in TWIST_TO_VARIANT) {
    return {
      pattern_type: "variant_b_twist",
      variant_label: TWIST_TO_VARIANT[twist],
      baseline_label: "control",
    };
  }
  // Playbook-id fallback — the playbook's structural intent is enough
  // to type the pattern even when the change_set doesn't carry a
  // marker. e.g. weak_above_the_fold proposals are about CTA
  // position; form_friction proposals are about form length.
  if (!args.playbook_id) return null;
  switch (args.playbook_id) {
    case "weak_above_the_fold":
      return {
        pattern_type: "cta_position",
        variant_label: "viewport_1",
        baseline_label: "viewport_2_plus",
      };
    case "form_friction":
      return {
        pattern_type: "form_field_count",
        variant_label: "le_5_fields",
        baseline_label: "gt_5_fields",
      };
    case "offer_clarity":
      return {
        pattern_type: "offer_above_fold",
        variant_label: "offer_above_fold",
        baseline_label: "offer_below_fold",
      };
    case "trust_gap":
      return {
        pattern_type: "trust_signal_placement",
        variant_label: "trust_adjacent_to_cta",
        baseline_label: "trust_isolated",
      };
    case "stale_social_proof":
      return {
        pattern_type: "social_proof_position",
        variant_label: "viewport_1_to_3",
        baseline_label: "viewport_4_plus",
      };
    case "cta_verb_mismatch":
      return {
        pattern_type: "cta_verb_match",
        variant_label: "matches_ad",
        baseline_label: "does_not_match_ad",
      };
    case "message_mismatch":
      return {
        pattern_type: "hero_keyword_match",
        variant_label: "h1_includes_top_keyword",
        baseline_label: "h1_excludes_top_keyword",
      };
    default:
      return null;
  }
}

/** One-line structural description matched to the (pattern_type,
 * variant, baseline) tuple — surfaced in the diagnostics + proposal
 * review UI. No content / brand / URL leakage. */
export function describePattern(c: PatternClassification): string {
  switch (c.pattern_type) {
    case "cta_position":
      return "Primary CTA placed in viewport 1 vs viewport 2+";
    case "form_field_count":
      return "Form length ≤ 5 fields vs > 5 fields";
    case "offer_above_fold":
      return "Offer restated above the fold vs only below";
    case "trust_signal_placement":
      return "Trust signals adjacent to CTA vs isolated section";
    case "social_proof_position":
      return "Social proof in viewport 1-3 vs viewport 4+";
    case "cta_verb_match":
      return "CTA verb matches ad copy vs differs";
    case "hero_keyword_match":
      return "Hero H1 includes the ad's top keyword vs excludes it";
    case "variant_b_twist":
      return `Variant B twist: ${c.variant_label.replace(/_/g, " ")} vs control`;
    default:
      return `${c.variant_label} vs ${c.baseline_label}`;
  }
}
