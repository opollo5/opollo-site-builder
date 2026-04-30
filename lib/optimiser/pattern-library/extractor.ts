import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import {
  classifyVariantOutcome,
  describePattern,
  type PatternClassification,
} from "./classify-pattern";
import { isPatternLibraryEnabled } from "./feature-flag";
import type { PatternConfidence, PatternObservation } from "./types";

// ---------------------------------------------------------------------------
// Cross-client pattern extractor (Phase 3 Slice 22).
//
// Daily cron iterates causal-delta + A/B winning-variant data ONLY for
// clients with cross_client_learning_consent=true on opt_clients,
// classifies each outcome into a (pattern_type, variant, baseline)
// triple via classifyVariantOutcome, aggregates across consenting
// clients, and UPSERTs one row per (type, variant, baseline,
// playbook_id) into opt_pattern_library.
//
// Anonymisation guarantees, enforced by construction:
//   - Only consenting clients contribute (cross_client_learning_consent
//     boolean on opt_clients, default false).
//   - Source columns (client_id, page_id, proposal_id, ad_group_id)
//     never persist — they're only used to count distinct contributors
//     and weight observations during aggregation.
//   - The persisted row carries pattern_type, structural variant
//     labels, sample-size aggregates, effect mean + 95% CI, and
//     confidence — no copy, URLs, brand names, or testimonial text.
//
// Feature flag: isPatternLibraryEnabled() (env var
// OPT_PATTERN_LIBRARY_ENABLED) must return true for the cron to do
// any work. Spec §11.2.4 requires MSA-clause adoption before this
// flag flips in production.
// ---------------------------------------------------------------------------

const MIN_CLIENTS_FOR_EXTRACTION = 2;

export interface ExtractorOutcome {
  pattern_type: string;
  variant_label: string;
  baseline_label: string;
  triggering_playbook_id: string | null;
  upserted: boolean;
  reason?: string;
}

export async function runPatternExtraction(): Promise<{
  enabled: boolean;
  consenting_clients: number;
  observations_total: number;
  patterns_upserted: number;
  outcomes: ExtractorOutcome[];
}> {
  if (!isPatternLibraryEnabled()) {
    return {
      enabled: false,
      consenting_clients: 0,
      observations_total: 0,
      patterns_upserted: 0,
      outcomes: [],
    };
  }

  const supabase = getServiceRoleClient();

  // 1. List consenting clients.
  const { data: consenting, error: clientsErr } = await supabase
    .from("opt_clients")
    .select("id")
    .eq("cross_client_learning_consent", true)
    .is("deleted_at", null);
  if (clientsErr) {
    throw new Error(`runPatternExtraction list clients: ${clientsErr.message}`);
  }
  const consentingIds = new Set(
    (consenting ?? []).map((c) => c.id as string),
  );
  if (consentingIds.size < MIN_CLIENTS_FOR_EXTRACTION) {
    return {
      enabled: true,
      consenting_clients: consentingIds.size,
      observations_total: 0,
      patterns_upserted: 0,
      outcomes: [],
    };
  }

  // 2. Collect observations from opt_causal_deltas — measured CR
  //    delta per applied proposal. Phase 3 expansion: also read
  //    opt_client_memory.winning_variants once Phase 2 A/B winners
  //    accumulate.
  const observations: PatternObservation[] = [];

  const { data: deltas, error: deltasErr } = await supabase
    .from("opt_causal_deltas")
    .select(
      "client_id, landing_page_id, proposal_id, change_set, actual_impact_cr, triggering_playbook_id, evaluation_window_start, evaluation_window_end",
    )
    .not("actual_impact_cr", "is", null);
  if (deltasErr) {
    logger.error("optimiser.pattern_extractor.deltas_failed", {
      error: deltasErr.message,
    });
  }
  for (const row of deltas ?? []) {
    if (!consentingIds.has(row.client_id as string)) continue;
    const cls = classifyVariantOutcome({
      change_set: (row.change_set ?? {}) as Record<string, unknown>,
      playbook_id: (row.triggering_playbook_id as string | null) ?? null,
    });
    if (!cls) continue;
    const observed = row.actual_impact_cr as number;
    observations.push({
      pattern_type: cls.pattern_type,
      variant_label: cls.variant_label,
      baseline_label: cls.baseline_label,
      triggering_playbook_id:
        (row.triggering_playbook_id as string | null) ?? null,
      client_id: row.client_id as string,
      page_id: row.landing_page_id as string,
      ad_group_id: null,
      proposal_id: row.proposal_id as string,
      // observed CR delta is stored as a relative ratio in
      // opt_causal_deltas; convert to percentage points (×100) and
      // round to the schema's numeric(6,3) precision.
      observed_effect_pp: Math.round(observed * 1000) / 10,
      sample_size: 1,
    });
  }

  // 3. Aggregate per (pattern_type, variant_label, baseline_label,
  //    triggering_playbook_id) tuple.
  const grouped = groupObservations(observations);

  // 4. UPSERT each group as one opt_pattern_library row.
  const outcomes: ExtractorOutcome[] = [];
  let upsertedCount = 0;
  const nowIso = new Date().toISOString();
  for (const group of grouped.values()) {
    const distinctClients = new Set(group.observations.map((o) => o.client_id))
      .size;
    if (distinctClients < MIN_CLIENTS_FOR_EXTRACTION) {
      outcomes.push({
        pattern_type: group.pattern_type,
        variant_label: group.variant_label,
        baseline_label: group.baseline_label,
        triggering_playbook_id: group.triggering_playbook_id,
        upserted: false,
        reason: `single_client_only:${distinctClients}`,
      });
      continue;
    }
    const distinctPages = new Set(group.observations.map((o) => o.page_id))
      .size;
    const distinctAdGroups = new Set(
      group.observations
        .map((o) => o.ad_group_id)
        .filter((v): v is string => v != null),
    ).size;
    const effects = group.observations.map((o) => o.observed_effect_pp);
    const stats = summariseEffects(effects);
    const confidence = deriveConfidence(distinctClients, stats);
    const cls: PatternClassification = {
      pattern_type: group.pattern_type,
      variant_label: group.variant_label,
      baseline_label: group.baseline_label,
    };

    const { error: upsertErr } = await supabase
      .from("opt_pattern_library")
      .upsert(
        {
          pattern_type: group.pattern_type,
          observation: describePattern(cls),
          variant_label: group.variant_label,
          baseline_label: group.baseline_label,
          sample_size_pages: distinctPages,
          sample_size_ad_groups: distinctAdGroups,
          sample_size_clients: distinctClients,
          sample_size_observations: group.observations.length,
          effect_pp_mean: stats.mean,
          effect_pp_ci_low: stats.ci_low,
          effect_pp_ci_high: stats.ci_high,
          confidence,
          triggering_playbook_id: group.triggering_playbook_id,
          last_extracted_at: nowIso,
        },
        {
          onConflict:
            "pattern_type,variant_label,baseline_label,triggering_playbook_id",
        },
      );
    if (upsertErr) {
      logger.error("optimiser.pattern_extractor.upsert_failed", {
        pattern_type: group.pattern_type,
        error: upsertErr.message,
      });
      outcomes.push({
        pattern_type: group.pattern_type,
        variant_label: group.variant_label,
        baseline_label: group.baseline_label,
        triggering_playbook_id: group.triggering_playbook_id,
        upserted: false,
        reason: `upsert_failed:${upsertErr.message}`,
      });
      continue;
    }
    upsertedCount += 1;
    outcomes.push({
      pattern_type: group.pattern_type,
      variant_label: group.variant_label,
      baseline_label: group.baseline_label,
      triggering_playbook_id: group.triggering_playbook_id,
      upserted: true,
    });
  }

  return {
    enabled: true,
    consenting_clients: consentingIds.size,
    observations_total: observations.length,
    patterns_upserted: upsertedCount,
    outcomes,
  };
}

interface ObservationGroup {
  pattern_type: string;
  variant_label: string;
  baseline_label: string;
  triggering_playbook_id: string | null;
  observations: PatternObservation[];
}

function groupObservations(
  observations: PatternObservation[],
): Map<string, ObservationGroup> {
  const out = new Map<string, ObservationGroup>();
  for (const obs of observations) {
    const key = `${obs.pattern_type}|${obs.variant_label}|${obs.baseline_label}|${obs.triggering_playbook_id ?? ""}`;
    let group = out.get(key);
    if (!group) {
      group = {
        pattern_type: obs.pattern_type,
        variant_label: obs.variant_label,
        baseline_label: obs.baseline_label,
        triggering_playbook_id: obs.triggering_playbook_id,
        observations: [],
      };
      out.set(key, group);
    }
    group.observations.push(obs);
  }
  return out;
}

function summariseEffects(values: number[]): {
  mean: number;
  ci_low: number;
  ci_high: number;
} {
  if (values.length === 0) return { mean: 0, ci_low: 0, ci_high: 0 };
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean: round3(mean), ci_low: round3(mean), ci_high: round3(mean) };
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  // 95% CI of the mean via z-approximation.
  const halfWidth = 1.96 * (stddev / Math.sqrt(n));
  return {
    mean: round3(mean),
    ci_low: round3(mean - halfWidth),
    ci_high: round3(mean + halfWidth),
  };
}

function deriveConfidence(
  distinctClients: number,
  stats: { mean: number; ci_low: number; ci_high: number },
): PatternConfidence {
  if (distinctClients >= 10 && (stats.ci_low > 0 || stats.ci_high < 0)) {
    return "high";
  }
  if (distinctClients >= 5) return "moderate";
  return "low";
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
