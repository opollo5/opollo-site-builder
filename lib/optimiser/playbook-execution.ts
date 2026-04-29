import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import type { PageMetricsRollup } from "./metrics-aggregation";
import type { PageSnapshot } from "./page-content-analysis";

// ---------------------------------------------------------------------------
// Playbook trigger evaluation (spec §9.6 + Table 23 / 24 / 25).
//
// Each opt_playbooks row carries a `trigger` JSONB of the shape:
//   { all: [{metric, op, value}, ...] }  // every condition must be true
//   { any: [{metric, op, value}, ...] }  // at least one must be true
//
// `op` ∈ {gt, lt, gte, lte, eq, ne}. `metric` is the dotted path into the
// evaluator's metric bag; the playbook seed migration uses snake_case
// names this evaluator understands.
//
// The evaluator is pure: given the playbook and a metric bag, returns
// {fired, magnitude, reasons}. Magnitude (0–1) feeds the §9.4.1 signal
// factor of the confidence calculation.
// ---------------------------------------------------------------------------

export type PlaybookTrigger =
  | { all: TriggerCondition[] }
  | { any: TriggerCondition[] }
  | Record<string, never>;

export type TriggerCondition = {
  metric: string;
  op: "gt" | "lt" | "gte" | "lte" | "eq" | "ne";
  value: number | boolean;
};

export type PlaybookRow = {
  id: string;
  name: string;
  category: "content_fix" | "technical_alert";
  trigger: PlaybookTrigger;
  default_risk_level: "low" | "medium" | "high";
  default_effort_bucket: 1 | 2 | 4;
  seed_impact_min_pp: number;
  seed_impact_max_pp: number;
  fix_template: string | null;
  enabled: boolean;
};

export type EvaluationResult = {
  fired: boolean;
  magnitude: number;
  reasons: Array<{ metric: string; op: string; threshold: number | boolean; observed: number | boolean | null; passed: boolean }>;
};

export type MetricBag = {
  alignment_score: number | null;
  bounce_rate: number;
  conversion_rate: number;
  avg_scroll_depth: number;
  avg_scroll_depth_desktop: number;
  form_starts: number;
  form_completion_rate: number;
  cta_verb_match: boolean;
  cta_above_fold: boolean;
  offer_above_fold: boolean;
  lcp_ms: number | null;
  mobile_speed_score: number | null;
  mobile_cr_vs_desktop_ratio: number | null;
  sessions_14d: number;
  conversions_14d: number;
  clicks_14d: number;
};

export function buildMetricBag(args: {
  rollup: PageMetricsRollup;
  snapshot: PageSnapshot;
  alignmentScore: number | null;
  ctaVerbMatch: boolean | null;
  /** Form starts = sessions that interacted with the form. Phase 1
   * approximation: estimate from sessions when GA4 form_start events
   * aren't configured. The playbook trigger compares > 50, so a low
   * estimate just suppresses the playbook. */
  formStarts?: number;
  formCompletionRate?: number;
  /** Last 14 days metrics for the tracking-broken alert. */
  sessions14d?: number;
  conversions14d?: number;
  clicks14d?: number;
}): MetricBag {
  return {
    alignment_score: args.alignmentScore,
    bounce_rate: args.rollup.bounce_rate,
    conversion_rate: args.rollup.conversion_rate,
    avg_scroll_depth: args.rollup.avg_scroll_depth,
    avg_scroll_depth_desktop: args.rollup.avg_scroll_depth,
    form_starts: args.formStarts ?? 0,
    form_completion_rate: args.formCompletionRate ?? 0,
    cta_verb_match: args.ctaVerbMatch ?? true,
    cta_above_fold: args.snapshot.cta_above_fold,
    offer_above_fold: args.snapshot.offer_above_fold,
    lcp_ms: args.rollup.lcp_ms,
    mobile_speed_score: args.rollup.mobile_speed_score,
    mobile_cr_vs_desktop_ratio: args.rollup.mobile_cr_vs_desktop_ratio,
    sessions_14d: args.sessions14d ?? args.rollup.sessions,
    conversions_14d: args.conversions14d ?? args.rollup.conversions,
    clicks_14d: args.clicks14d ?? args.rollup.clicks,
  };
}

export function evaluatePlaybook(
  playbook: PlaybookRow,
  bag: MetricBag,
): EvaluationResult {
  const trigger = playbook.trigger;
  if (!trigger || (!("all" in trigger) && !("any" in trigger))) {
    return { fired: false, magnitude: 0, reasons: [] };
  }

  const conditions: TriggerCondition[] =
    "all" in trigger ? trigger.all : (trigger as { any: TriggerCondition[] }).any;
  const mode: "all" | "any" = "all" in trigger ? "all" : "any";

  const reasons: EvaluationResult["reasons"] = [];
  let magnitudeAcc = 0;
  let magnitudeN = 0;

  for (const cond of conditions) {
    const observed = (bag as unknown as Record<string, number | boolean | null>)[
      cond.metric
    ];
    const passed = compare(observed, cond.op, cond.value);
    reasons.push({
      metric: cond.metric,
      op: cond.op,
      threshold: cond.value,
      observed,
      passed,
    });
    if (passed && typeof observed === "number" && typeof cond.value === "number") {
      magnitudeAcc += magnitudeFor(observed, cond.value, cond.op);
      magnitudeN += 1;
    }
  }

  const fired =
    mode === "all"
      ? reasons.every((r) => r.passed)
      : reasons.some((r) => r.passed);

  const magnitude =
    magnitudeN > 0 ? Math.max(0.4, Math.min(1, magnitudeAcc / magnitudeN)) : 0;
  return { fired, magnitude, reasons };
}

function compare(
  observed: number | boolean | null,
  op: TriggerCondition["op"],
  threshold: number | boolean,
): boolean {
  if (observed === null) return false;
  if (typeof observed === "boolean" || typeof threshold === "boolean") {
    if (op === "eq") return observed === threshold;
    if (op === "ne") return observed !== threshold;
    return false;
  }
  switch (op) {
    case "gt":
      return observed > threshold;
    case "lt":
      return observed < threshold;
    case "gte":
      return observed >= threshold;
    case "lte":
      return observed <= threshold;
    case "eq":
      return observed === threshold;
    case "ne":
      return observed !== threshold;
  }
}

function magnitudeFor(
  observed: number,
  threshold: number,
  op: TriggerCondition["op"],
): number {
  // Distance from the threshold scaled into [0, 1] — clamped at 0.4
  // for "just over" and 1.0 for "severely over". Direction depends on
  // op.
  let signedDist = 0;
  if (op === "gt" || op === "gte") signedDist = (observed - threshold) / (threshold || 1);
  else if (op === "lt" || op === "lte") signedDist = (threshold - observed) / (threshold || 1);
  else return 0.6;
  if (signedDist <= 0) return 0;
  return 0.4 + Math.min(0.6, signedDist);
}

/** List enabled Phase 1 content_fix playbooks. */
export async function listPhase1ContentPlaybooks(): Promise<PlaybookRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_playbooks")
    .select(
      "id, name, category, trigger, default_risk_level, default_effort_bucket, seed_impact_min_pp, seed_impact_max_pp, fix_template, enabled",
    )
    .eq("phase", "phase_1")
    .eq("category", "content_fix")
    .eq("enabled", true);
  if (error) throw new Error(`listPhase1ContentPlaybooks: ${error.message}`);
  return (data ?? []) as PlaybookRow[];
}

export async function listPhase1TechnicalAlertPlaybooks(): Promise<PlaybookRow[]> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_playbooks")
    .select(
      "id, name, category, trigger, default_risk_level, default_effort_bucket, seed_impact_min_pp, seed_impact_max_pp, fix_template, enabled",
    )
    .eq("phase", "phase_1")
    .eq("category", "technical_alert")
    .eq("enabled", true);
  if (error) throw new Error(`listPhase1TechnicalAlertPlaybooks: ${error.message}`);
  return (data ?? []) as PlaybookRow[];
}
