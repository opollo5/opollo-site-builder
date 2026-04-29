import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { computeConfidence } from "./confidence";
import type { PageMetricsRollup } from "./metrics-aggregation";
import type { PlaybookRow } from "./playbook-execution";

// ---------------------------------------------------------------------------
// Proposal generation (spec §9.1, §9.4, §9.7).
//
// Given:
//   - a fired playbook
//   - the page's rollup
//   - the alignment score (composite + subscores)
//   - the current performance snapshot
// produces:
//   - a `pending` proposal row in opt_proposals (idempotent on
//     (landing_page_id, triggering_playbook_id) for active proposals —
//     we don't double-up if the same playbook fires twice in one
//     window)
//   - opt_proposal_evidence rows linking the proposal to the metrics
//     and snapshot data that justified it
//
// Priority score (§9.4): impact × confidence / effort. impact is the
// playbook's seed range × current sessions × effort_weight. Slice 5
// uses the seed midpoint as the impact_score; Phase 2 calibration
// rewrites this in opt_playbooks.seed_impact_*.
//
// Expiry: now + 14 days per §9.7 default.
// ---------------------------------------------------------------------------

const PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type GenerateProposalInputs = {
  clientId: string;
  landingPageId: string;
  adGroupId: string | null;
  playbook: PlaybookRow;
  rollup: PageMetricsRollup;
  alignmentScore: number | null;
  alignmentSubscores: Record<string, number> | null;
  triggerEvidence: Array<{
    metric: string;
    op: string;
    threshold: number | boolean;
    observed: number | boolean | null;
    passed: boolean;
  }>;
  metricSeries?: number[];
  triggerMagnitude: number;
  /** Set of suppressed (playbook_id) values for this client per
   * §11.1 reason-gated suppression — Slice 6 wires this. */
  suppressed?: Set<string>;
};

export type GenerateProposalResult = {
  /** TRUE if a new pending proposal was inserted; FALSE if a duplicate
   * pending proposal already exists for the same (page, playbook) or
   * the playbook is suppressed for this client. */
  inserted: boolean;
  proposal_id: string | null;
  reason?: "duplicate" | "suppressed" | "ok";
};

export async function generateProposal(
  inputs: GenerateProposalInputs,
): Promise<GenerateProposalResult> {
  if (inputs.suppressed?.has(inputs.playbook.id)) {
    return { inserted: false, proposal_id: null, reason: "suppressed" };
  }

  const supabase = getServiceRoleClient();
  // Skip if a pending/approved proposal exists for the same (page, playbook).
  const { data: existing } = await supabase
    .from("opt_proposals")
    .select("id")
    .eq("landing_page_id", inputs.landingPageId)
    .eq("triggering_playbook_id", inputs.playbook.id)
    .in("status", ["pending", "approved"])
    .is("deleted_at", null)
    .limit(1);
  if (existing && existing.length > 0) {
    return {
      inserted: false,
      proposal_id: existing[0].id as string,
      reason: "duplicate",
    };
  }

  const confidence = computeConfidence({
    rollup: inputs.rollup,
    metric_series: inputs.metricSeries,
    trigger_magnitude: inputs.triggerMagnitude,
  });

  const seedMidpoint =
    (inputs.playbook.seed_impact_min_pp + inputs.playbook.seed_impact_max_pp) /
    2;
  // Impact (0–100): a relative score in the client's pool. Phase 1
  // approximation: seed midpoint × log(sessions+1) / 8, clamped.
  // Slice 6 will normalise across the client's pending pool, but the
  // monotonicity (more sessions × higher seed → higher impact) is in
  // place from day one.
  const impactRaw =
    seedMidpoint * (Math.log10((inputs.rollup.sessions || 0) + 1) / 4);
  const impact_score = Math.min(100, Math.max(0, impactRaw * 10));

  const effort = inputs.playbook.default_effort_bucket;
  const priority_score = (impact_score * confidence.score) / effort;
  const expires_at = new Date(Date.now() + PROPOSAL_TTL_MS).toISOString();

  const headline = buildHeadline(inputs);
  const problemSummary = buildProblemSummary(inputs);
  const changeSet = buildChangeSet(inputs);
  const beforeSnapshot = buildBeforeSnapshot(inputs);
  const afterSnapshot: Record<string, unknown> = {
    note:
      "Site Builder generation engine produces the after-snapshot at brief-submission time (Phase 1.5).",
  };
  const currentPerformance = {
    sessions: inputs.rollup.sessions,
    conversions: inputs.rollup.conversions,
    conversion_rate: inputs.rollup.conversion_rate,
    bounce_rate: inputs.rollup.bounce_rate,
    avg_scroll_depth: inputs.rollup.avg_scroll_depth,
    alignment_score: inputs.alignmentScore,
  };

  const insertPayload = {
    client_id: inputs.clientId,
    landing_page_id: inputs.landingPageId,
    ad_group_id: inputs.adGroupId,
    triggering_playbook_id: inputs.playbook.id,
    category: "content_fix" as const,
    status: "pending" as const,
    headline,
    problem_summary: problemSummary,
    risk_level: inputs.playbook.default_risk_level,
    priority_score: round3(priority_score),
    impact_score: round2(impact_score),
    effort_bucket: effort,
    confidence_score: confidence.score,
    confidence_sample: confidence.sample,
    confidence_freshness: confidence.freshness,
    confidence_stability: confidence.stability,
    confidence_signal: confidence.signal,
    expected_impact_min_pp: inputs.playbook.seed_impact_min_pp,
    expected_impact_max_pp: inputs.playbook.seed_impact_max_pp,
    change_set: changeSet,
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
    current_performance: currentPerformance,
    expires_at,
  };

  const { data: row, error } = await supabase
    .from("opt_proposals")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error || !row) {
    logger.error("optimiser.proposal_generation.insert_failed", {
      client_id: inputs.clientId,
      landing_page_id: inputs.landingPageId,
      playbook: inputs.playbook.id,
      error: error?.message,
    });
    throw new Error(`generateProposal: ${error?.message ?? "no row"}`);
  }

  // Evidence rows.
  type EvidenceInsert = {
    proposal_id: string;
    display_order: number;
    evidence_type: string;
    payload: Record<string, unknown>;
    label: string;
  };
  const evidence: EvidenceInsert[] = inputs.triggerEvidence
    .filter((e) => e.passed)
    .map((e, i) => ({
      proposal_id: row.id as string,
      display_order: i,
      evidence_type: "metric",
      payload: {
        metric: e.metric,
        op: e.op,
        threshold: e.threshold,
        observed: e.observed,
      },
      label: `${e.metric} ${e.op} ${formatBoundary(e.threshold)} (observed ${formatBoundary(e.observed)})`,
    }));

  if (inputs.alignmentScore != null) {
    evidence.push({
      proposal_id: row.id as string,
      display_order: evidence.length,
      evidence_type: "alignment_score",
      payload: {
        composite: inputs.alignmentScore,
        subscores: inputs.alignmentSubscores ?? {},
      },
      label: `Alignment score ${inputs.alignmentScore}/100`,
    });
  }

  if (evidence.length > 0) {
    const { error: evErr } = await supabase
      .from("opt_proposal_evidence")
      .insert(evidence);
    if (evErr) {
      logger.warn("optimiser.proposal_generation.evidence_failed", {
        proposal_id: row.id,
        error: evErr.message,
      });
    }
  }

  return { inserted: true, proposal_id: row.id as string, reason: "ok" };
}

function buildHeadline(inputs: GenerateProposalInputs): string {
  return inputs.playbook.name;
}

function buildProblemSummary(inputs: GenerateProposalInputs): string {
  const passedReasons = inputs.triggerEvidence
    .filter((e) => e.passed)
    .map((e) => `${e.metric} ${e.op} ${formatBoundary(e.threshold)} (observed ${formatBoundary(e.observed)})`)
    .join("; ");
  return `${inputs.playbook.name}: ${passedReasons || "trigger conditions met"}.`;
}

function buildChangeSet(
  inputs: GenerateProposalInputs,
): Record<string, unknown> {
  // Phase 1 change-set is the playbook's fix_template plus the
  // observed metric values. The Site Builder brief (Phase 1.5) will
  // expand this into a structured section diff.
  return {
    playbook_id: inputs.playbook.id,
    fix_template: inputs.playbook.fix_template,
    target: { landing_page_id: inputs.landingPageId },
    metrics_observed: inputs.triggerEvidence,
  };
}

function buildBeforeSnapshot(
  inputs: GenerateProposalInputs,
): Record<string, unknown> {
  return {
    sessions: inputs.rollup.sessions,
    conversions: inputs.rollup.conversions,
    conversion_rate: inputs.rollup.conversion_rate,
    bounce_rate: inputs.rollup.bounce_rate,
    avg_scroll_depth: inputs.rollup.avg_scroll_depth,
    alignment_score: inputs.alignmentScore,
    alignment_subscores: inputs.alignmentSubscores ?? {},
  };
}

function formatBoundary(v: number | boolean | null): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return String(v);
  return Number.isFinite(v) ? String(round3(v)) : String(v);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
