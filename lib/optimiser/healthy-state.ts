import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { OptPageState } from "./types";
import type { PageMetricsRollup } from "./metrics-aggregation";
import type { ReliabilityResult } from "./data-reliability";

// ---------------------------------------------------------------------------
// Healthy state evaluation (§9.9).
//
// A page is `healthy` when ALL of:
//   - Alignment score ≥ 70
//   - CR within ±20% of the client's active-pages average
//   - No Phase 1 playbook trigger condition currently met
//   - No technical alert firing
//   - Data thresholds (§9.5) met — i.e. enough data to make this judgement
//
// `insufficient_data` short-circuits if §9.5 thresholds fail.
// `read_only_external` for non-Site-Builder-managed pages with
//   management_mode = 'read_only'.
// `active` is the default — page in active management with usable data
//   but doesn't meet the healthy bar.
//
// State transitions are written as opt_change_log rows so staff can see
// when + why a previously-healthy page started needing attention.
// ---------------------------------------------------------------------------

export type HealthyStateInputs = {
  rollup: PageMetricsRollup;
  reliability: ReliabilityResult;
  alignment_score: number | null;
  client_active_avg_cr: number | null;
  active_technical_alerts: string[];
  /** Set of playbook ids whose trigger currently evaluates true on this page. */
  active_playbook_triggers: string[];
  management_mode: "read_only" | "full_automation";
};

export type HealthyStateResult = {
  state: OptPageState;
  reasons: Array<{ code: string; message: string; passed: boolean }>;
};

export type DataThresholds = {
  min_sessions?: number;
  min_conversions?: number;
  min_spend_usd_cents?: number;
  min_window_days?: number;
};

const DEFAULT_THRESHOLDS: Required<DataThresholds> = {
  min_sessions: 100,
  min_conversions: 10,
  min_spend_usd_cents: 500 * 100,
  min_window_days: 7,
};

export function evaluateHealthyState(
  inputs: HealthyStateInputs,
  thresholds: DataThresholds = {},
): HealthyStateResult {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const reasons: HealthyStateResult["reasons"] = [];

  if (inputs.management_mode === "read_only") {
    reasons.push({
      code: "read_only_external",
      message: "Page is managed in read-only mode (external).",
      passed: true,
    });
    return { state: "read_only_external", reasons };
  }

  // §9.5 thresholds: must clear AT LEAST sessions, conversions OR spend, window.
  const sessionsOk = inputs.rollup.sessions >= t.min_sessions;
  const conversionsOk = inputs.rollup.conversions >= t.min_conversions;
  const spendOk = inputs.rollup.spend_usd_cents >= t.min_spend_usd_cents;
  const windowOk = inputs.rollup.window_days >= t.min_window_days;
  const dataOk = sessionsOk && (conversionsOk || spendOk) && windowOk;

  reasons.push({
    code: "min_sessions",
    message: `sessions ${inputs.rollup.sessions} ${sessionsOk ? "≥" : "<"} ${t.min_sessions}`,
    passed: sessionsOk,
  });
  reasons.push({
    code: "min_conversions_or_spend",
    message:
      `conversions ${inputs.rollup.conversions} (need ${t.min_conversions}) ` +
      `or spend $${(inputs.rollup.spend_usd_cents / 100).toFixed(0)} (need $${t.min_spend_usd_cents / 100})`,
    passed: conversionsOk || spendOk,
  });
  reasons.push({
    code: "min_window_days",
    message: `window ${inputs.rollup.window_days}d ${windowOk ? "≥" : "<"} ${t.min_window_days}d`,
    passed: windowOk,
  });

  if (!dataOk) {
    return { state: "insufficient_data", reasons };
  }

  // Alignment score gate.
  const alignmentOk =
    inputs.alignment_score != null && inputs.alignment_score >= 70;
  reasons.push({
    code: "alignment_score",
    message:
      inputs.alignment_score != null
        ? `alignment ${inputs.alignment_score} ${alignmentOk ? "≥" : "<"} 70`
        : "alignment score not yet computed",
    passed: alignmentOk,
  });

  // CR within ±20% of client active-pages average.
  let crOk = true;
  if (inputs.client_active_avg_cr != null && inputs.client_active_avg_cr > 0) {
    const lo = inputs.client_active_avg_cr * 0.8;
    const hi = inputs.client_active_avg_cr * 1.2;
    crOk =
      inputs.rollup.conversion_rate >= lo &&
      inputs.rollup.conversion_rate <= hi;
    reasons.push({
      code: "cr_within_band",
      message: `CR ${(inputs.rollup.conversion_rate * 100).toFixed(2)}% vs active avg ${(inputs.client_active_avg_cr * 100).toFixed(2)}% (±20%)`,
      passed: crOk,
    });
  } else {
    reasons.push({
      code: "cr_within_band",
      message: "no client active-pages average — skip band check",
      passed: true,
    });
  }

  const noPlaybookFiring = inputs.active_playbook_triggers.length === 0;
  reasons.push({
    code: "no_playbook_firing",
    message: noPlaybookFiring
      ? "no Phase 1 playbook firing"
      : `playbook(s) firing: ${inputs.active_playbook_triggers.join(", ")}`,
    passed: noPlaybookFiring,
  });

  const noTechAlert = inputs.active_technical_alerts.length === 0;
  reasons.push({
    code: "no_technical_alert",
    message: noTechAlert
      ? "no technical alert"
      : `alert(s): ${inputs.active_technical_alerts.join(", ")}`,
    passed: noTechAlert,
  });

  if (alignmentOk && crOk && noPlaybookFiring && noTechAlert) {
    return { state: "healthy", reasons };
  }
  return { state: "active", reasons };
}

/** Persist evaluator output back onto opt_landing_pages and emit a
 * change-log row when state changes. */
export async function persistEvaluation(args: {
  clientId: string;
  landingPageId: string;
  result: HealthyStateResult;
  reliability: ReliabilityResult;
  activeTechnicalAlerts: string[];
}): Promise<{ changed: boolean }> {
  const supabase = getServiceRoleClient();
  const { data: prev, error: fetchErr } = await supabase
    .from("opt_landing_pages")
    .select("state")
    .eq("id", args.landingPageId)
    .maybeSingle();
  if (fetchErr) {
    throw new Error(`persistEvaluation fetch: ${fetchErr.message}`);
  }
  const prevState = prev?.state as OptPageState | null;
  const nowIso = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("opt_landing_pages")
    .update({
      state: args.result.state,
      state_evaluated_at: nowIso,
      state_reasons: args.result.reasons,
      data_reliability: args.reliability.reliability,
      data_reliability_checks: args.reliability.checks,
      active_technical_alerts: args.activeTechnicalAlerts,
    })
    .eq("id", args.landingPageId);
  if (updateErr) {
    throw new Error(`persistEvaluation update: ${updateErr.message}`);
  }

  if (prevState && prevState !== args.result.state) {
    const { error: logErr } = await supabase.from("opt_change_log").insert({
      client_id: args.clientId,
      landing_page_id: args.landingPageId,
      event: "page_state_transition",
      details: {
        from: prevState,
        to: args.result.state,
        reasons: args.result.reasons.filter((r) => !r.passed),
        reliability: args.reliability.reliability,
      },
    });
    if (logErr) {
      logger.error("optimiser.healthy_state.log_failed", {
        landing_page_id: args.landingPageId,
        error: logErr.message,
      });
    }
    return { changed: true };
  }
  return { changed: false };
}

/**
 * Convenience: pull all the evaluator inputs for a page from current
 * DB state and run the evaluator end-to-end. Used by the daily
 * evaluation cron.
 */
export async function evaluateAndPersistPage(args: {
  landingPageId: string;
  clientId: string;
  managementMode: "read_only" | "full_automation";
  rollup: PageMetricsRollup;
  reliability: ReliabilityResult;
  clientActiveAvgCr: number | null;
}): Promise<HealthyStateResult> {
  const supabase = getServiceRoleClient();

  // Most recent alignment score, if any.
  const { data: scoreRow } = await supabase
    .from("opt_alignment_scores")
    .select("score")
    .eq("landing_page_id", args.landingPageId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const alignment_score = (scoreRow?.score as number | null) ?? null;

  // Active technical alerts derive from the rollup. Phase 1 set:
  // page_speed (LCP > 2500 OR mobile_speed < 50)
  // mobile_only_failure (mobile_cr/desktop_cr < 0.25)
  const technicalAlerts: string[] = [];
  if (
    (args.rollup.lcp_ms != null && args.rollup.lcp_ms > 2500) ||
    (args.rollup.mobile_speed_score != null && args.rollup.mobile_speed_score < 50)
  ) {
    technicalAlerts.push("page_speed");
  }
  if (
    args.rollup.mobile_cr_vs_desktop_ratio != null &&
    args.rollup.mobile_cr_vs_desktop_ratio < 0.25
  ) {
    technicalAlerts.push("mobile_only_failure");
  }

  const result = evaluateHealthyState({
    rollup: args.rollup,
    reliability: args.reliability,
    alignment_score,
    client_active_avg_cr: args.clientActiveAvgCr,
    active_technical_alerts: technicalAlerts,
    active_playbook_triggers: [],
    management_mode: args.managementMode,
  });

  await persistEvaluation({
    clientId: args.clientId,
    landingPageId: args.landingPageId,
    result,
    reliability: args.reliability,
    activeTechnicalAlerts: technicalAlerts,
  });
  return result;
}
