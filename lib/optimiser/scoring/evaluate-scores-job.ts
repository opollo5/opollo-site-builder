import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { computeReliability } from "../data-reliability";
import { rollupForPage } from "../metrics-aggregation";
import {
  computeBehaviourSubscore,
  type BehaviourCohortRow,
} from "./behaviour-subscore";
import {
  computeCompositeScore,
  lowestContribution,
} from "./composite-score";
import {
  computeConversionSubscore,
  costPerConversionFromRollup,
  type ConversionCohortRow,
} from "./conversion-subscore";
import { computeTechnicalSubscore } from "./technical-subscore";
import {
  DEFAULT_CONVERSION_COMPONENTS,
  DEFAULT_SCORE_WEIGHTS,
  type ConversionComponentsPresent,
  type ScoreWeights,
} from "./types";

// ---------------------------------------------------------------------------
// Daily score-evaluation job (Slice 12).
//
// For each managed page:
//   1. Compute the 30-day rollup
//   2. Look up the latest alignment score from opt_alignment_scores
//   3. Compute behaviour, conversion, technical sub-scores against the
//      client's active-pages cohort (per-client percentile normalisation)
//   4. Assemble the composite + classification per addendum §2
//   5. Update opt_landing_pages.current_composite_score +
//      current_classification
//   6. Insert a row into opt_page_score_history
//
// Bounded by client; per-client failure isolated.
// ---------------------------------------------------------------------------

export type EvaluateScoresOutcome = {
  client_id: string;
  pages_scored: number;
  pages_skipped: number;
  errors: number;
};

export async function runEvaluateScoresForAllClients(): Promise<{
  outcomes: EvaluateScoresOutcome[];
  total_pages: number;
}> {
  const supabase = getServiceRoleClient();
  const { data: clients, error } = await supabase
    .from("opt_clients")
    .select(
      "id, score_weights, conversion_components_present",
    )
    .is("deleted_at", null);
  if (error) {
    throw new Error(`runEvaluateScoresForAllClients: ${error.message}`);
  }

  const outcomes: EvaluateScoresOutcome[] = [];
  let total_pages = 0;
  for (const client of clients ?? []) {
    const o = await runForClient({
      clientId: client.id as string,
      weights: (client.score_weights as ScoreWeights | null) ??
        DEFAULT_SCORE_WEIGHTS,
      componentsPresent:
        (client.conversion_components_present as
          | ConversionComponentsPresent
          | null) ?? DEFAULT_CONVERSION_COMPONENTS,
    });
    total_pages += o.pages_scored;
    outcomes.push(o);
  }
  return { outcomes, total_pages };
}

async function runForClient(args: {
  clientId: string;
  weights: ScoreWeights;
  componentsPresent: ConversionComponentsPresent;
}): Promise<EvaluateScoresOutcome> {
  const supabase = getServiceRoleClient();
  const { data: pages, error } = await supabase
    .from("opt_landing_pages")
    .select(
      "id, conversion_n_a, page_id, management_mode",
    )
    .eq("client_id", args.clientId)
    .eq("managed", true)
    .is("deleted_at", null);
  if (error) {
    logger.error("optimiser.evaluate_scores.list_failed", {
      client_id: args.clientId,
      error: error.message,
    });
    return {
      client_id: args.clientId,
      pages_scored: 0,
      pages_skipped: 0,
      errors: 1,
    };
  }

  if (!pages || pages.length === 0) {
    return {
      client_id: args.clientId,
      pages_scored: 0,
      pages_skipped: 0,
      errors: 0,
    };
  }

  // Build the cohort once per client. Each entry is an active-pages
  // snapshot used by the percentile normalisation.
  const cohort = await buildClientCohort(args.clientId);
  let scored = 0;
  let skipped = 0;
  let errs = 0;

  for (const page of pages) {
    try {
      const result = await evaluatePage({
        clientId: args.clientId,
        landingPageId: page.id as string,
        conversionNotApplicable: Boolean(page.conversion_n_a),
        weights: args.weights,
        componentsPresent: args.componentsPresent,
        behaviourCohort: cohort.behaviour,
        conversionCohort: cohort.conversion,
      });
      if (result.skipped) {
        skipped += 1;
      } else {
        scored += 1;
      }
    } catch (err) {
      errs += 1;
      logger.error("optimiser.evaluate_scores.failed", {
        client_id: args.clientId,
        landing_page_id: page.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    client_id: args.clientId,
    pages_scored: scored,
    pages_skipped: skipped,
    errors: errs,
  };
}

async function evaluatePage(args: {
  clientId: string;
  landingPageId: string;
  conversionNotApplicable: boolean;
  weights: ScoreWeights;
  componentsPresent: ConversionComponentsPresent;
  behaviourCohort: BehaviourCohortRow[];
  conversionCohort: ConversionCohortRow[];
}): Promise<{ skipped: boolean }> {
  const supabase = getServiceRoleClient();
  const rollup = await rollupForPage(args.landingPageId);
  const reliability = computeReliability(rollup);

  // §9.5 thresholds: skip score evaluation if the data isn't
  // sufficient. The healthy-state evaluator already handles the
  // insufficient_data state; we just don't write a misleading score.
  if (reliability.reliability === "red") {
    return { skipped: true };
  }

  const alignmentScore = await fetchLatestAlignmentScore(args.landingPageId);
  const behaviour = computeBehaviourSubscore(rollup, args.behaviourCohort);
  const conversion = args.conversionNotApplicable
    ? null
    : computeConversionSubscore({
        rollup,
        cohort: args.conversionCohort,
        componentsPresent: args.componentsPresent,
        costPerConversionCents: costPerConversionFromRollup(rollup) ?? undefined,
      });
  const technical = computeTechnicalSubscore(rollup);

  const composite = computeCompositeScore({
    subscores: {
      alignment: alignmentScore,
      behaviour: behaviour?.score ?? null,
      conversion: conversion?.score ?? null,
      technical: technical?.score ?? null,
    },
    configuredWeights: args.weights,
    conversionNotApplicable: args.conversionNotApplicable,
  });
  if (!composite) {
    return { skipped: true };
  }

  const nowIso = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("opt_landing_pages")
    .update({
      current_composite_score: composite.composite_score,
      current_classification: composite.classification,
      updated_at: nowIso,
    })
    .eq("id", args.landingPageId);
  if (updateErr) {
    throw new Error(`evaluatePage update: ${updateErr.message}`);
  }

  const { error: histErr } = await supabase
    .from("opt_page_score_history")
    .insert({
      client_id: args.clientId,
      landing_page_id: args.landingPageId,
      composite_score: composite.composite_score,
      classification: composite.classification,
      alignment_subscore: alignmentScore,
      behaviour_subscore: behaviour?.score ?? null,
      conversion_subscore: conversion?.score ?? null,
      technical_subscore: technical?.score ?? null,
      weights_used: composite.weights_used,
      evaluated_at: nowIso,
    });
  if (histErr) {
    throw new Error(`evaluatePage history insert: ${histErr.message}`);
  }
  void lowestContribution; // imported for callers; not needed here.

  return { skipped: false };
}

async function fetchLatestAlignmentScore(
  landingPageId: string,
): Promise<number | null> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("opt_alignment_scores")
    .select("score")
    .eq("landing_page_id", landingPageId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.score as number | null) ?? null;
}

async function buildClientCohort(clientId: string): Promise<{
  behaviour: BehaviourCohortRow[];
  conversion: ConversionCohortRow[];
}> {
  const supabase = getServiceRoleClient();
  const { data: pages } = await supabase
    .from("opt_landing_pages")
    .select("id")
    .eq("client_id", clientId)
    .eq("managed", true)
    .is("deleted_at", null);
  const behaviour: BehaviourCohortRow[] = [];
  const conversion: ConversionCohortRow[] = [];
  for (const p of pages ?? []) {
    const r = await rollupForPage(p.id as string);
    const cpa = costPerConversionFromRollup(r);
    behaviour.push({
      bounce_rate: r.bounce_rate > 0 ? r.bounce_rate : null,
      avg_engagement_time_s:
        r.avg_engagement_time_s > 0 ? r.avg_engagement_time_s : null,
      avg_scroll_depth: r.avg_scroll_depth > 0 ? r.avg_scroll_depth : null,
    });
    conversion.push({
      conversion_rate: r.conversion_rate > 0 ? r.conversion_rate : null,
      cost_per_conversion: cpa,
    });
  }
  return { behaviour, conversion };
}
