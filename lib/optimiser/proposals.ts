import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import type { OptProposalCategory, OptProposalStatus, OptRiskLevel } from "./types";
import { recordRejection } from "./client-memory";
import { recordChangeLog } from "./change-log";
import { lintChangeSet, type GuardrailResult } from "./guardrails";
import { submitBriefForProposal } from "./site-builder-bridge/submit-brief";

// ---------------------------------------------------------------------------
// opt_proposals DAO + approve/reject/expire helpers.
// ---------------------------------------------------------------------------

export type Proposal = {
  id: string;
  client_id: string;
  landing_page_id: string;
  ad_group_id: string | null;
  triggering_playbook_id: string | null;
  category: OptProposalCategory;
  status: OptProposalStatus;
  headline: string;
  problem_summary: string | null;
  risk_level: OptRiskLevel;
  priority_score: number;
  impact_score: number;
  effort_bucket: number;
  confidence_score: number;
  confidence_sample: number | null;
  confidence_freshness: number | null;
  confidence_stability: number | null;
  confidence_signal: number | null;
  expected_impact_min_pp: number | null;
  expected_impact_max_pp: number | null;
  change_set: Record<string, unknown>;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
  current_performance: Record<string, unknown>;
  rejection_reason_code: string | null;
  rejection_reason_text: string | null;
  pre_build_reprompt: string | null;
  submitted_brief_id: string | null;
  expires_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  applied_at: string | null;
  version_lock: number;
  created_at: string;
  updated_at: string;
};

const PROPOSAL_COLS =
  "id, client_id, landing_page_id, ad_group_id, triggering_playbook_id, category, status, headline, problem_summary, risk_level, priority_score, impact_score, effort_bucket, confidence_score, confidence_sample, confidence_freshness, confidence_stability, confidence_signal, expected_impact_min_pp, expected_impact_max_pp, change_set, before_snapshot, after_snapshot, current_performance, rejection_reason_code, rejection_reason_text, pre_build_reprompt, submitted_brief_id, expires_at, approved_at, approved_by, rejected_at, rejected_by, applied_at, version_lock, created_at, updated_at";

export async function listPendingProposals(args: {
  clientId?: string;
  riskLevel?: OptRiskLevel;
  limit?: number;
}): Promise<Proposal[]> {
  const supabase = getServiceRoleClient();
  let q = supabase
    .from("opt_proposals")
    .select(PROPOSAL_COLS)
    .eq("status", "pending")
    .eq("category", "content_fix")
    .is("deleted_at", null)
    .order("priority_score", { ascending: false });
  if (args.clientId) q = q.eq("client_id", args.clientId);
  if (args.riskLevel) q = q.eq("risk_level", args.riskLevel);
  if (args.limit) q = q.limit(args.limit);
  const { data, error } = await q;
  if (error) throw new Error(`listPendingProposals: ${error.message}`);
  return (data ?? []) as Proposal[];
}

export async function getProposalWithEvidence(id: string): Promise<{
  proposal: Proposal | null;
  evidence: Array<{
    id: string;
    display_order: number;
    evidence_type: string;
    payload: Record<string, unknown>;
    label: string | null;
  }>;
}> {
  const supabase = getServiceRoleClient();
  const { data: proposal, error } = await supabase
    .from("opt_proposals")
    .select(PROPOSAL_COLS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`getProposal: ${error.message}`);
  if (!proposal) return { proposal: null, evidence: [] };

  const { data: evidence } = await supabase
    .from("opt_proposal_evidence")
    .select("id, display_order, evidence_type, payload, label")
    .eq("proposal_id", id)
    .order("display_order", { ascending: true });

  return {
    proposal: proposal as Proposal,
    evidence: (evidence ?? []).map((e) => ({
      id: e.id as string,
      display_order: e.display_order as number,
      evidence_type: e.evidence_type as string,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      label: e.label as string | null,
    })),
  };
}

export type ApproveResult =
  | {
      ok: true;
      proposal_id: string;
      /**
       * True when submit-brief succeeded and the proposal is now in
       * `applying`. False when submit-brief failed but the approval
       * itself is recorded — staff can retry via the manual handoff.
       */
      brief_submitted: boolean;
      /** Set when brief_submitted = true. */
      brief_id?: string;
      /** Set when brief_submitted = true. */
      brief_run_id?: string;
      /** Set when brief_submitted = true. */
      output_mode?: "slice" | "full_page";
      /** Set when brief_submitted = false. */
      submit_error?: { code: string; message: string };
    }
  | {
      ok: false;
      code: "EXPIRED" | "GUARDRAIL_FAILED" | "STATUS_CONFLICT" | "INTERNAL_ERROR";
      message: string;
      guardrail?: GuardrailResult;
    };

export async function approveProposal(args: {
  proposalId: string;
  approverUserId: string | null;
  preBuildReprompt?: string;
  /** Set of evidence row ids the operator unchecked — reserved for
   * Phase 1.5 partial approval. Phase 1: ignored, all evidence kept. */
  uncheckedEvidence?: string[];
}): Promise<ApproveResult> {
  const supabase = getServiceRoleClient();
  const { data: row, error } = await supabase
    .from("opt_proposals")
    .select("id, status, expires_at, change_set, risk_level, before_snapshot, client_id, landing_page_id")
    .eq("id", args.proposalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`approveProposal fetch: ${error.message}`);
  if (!row) {
    return {
      ok: false,
      code: "STATUS_CONFLICT",
      message: "Proposal not found",
    };
  }
  if (row.status !== "pending") {
    return {
      ok: false,
      code: "STATUS_CONFLICT",
      message: `Proposal is in status ${row.status}`,
    };
  }
  if (row.expires_at && new Date(row.expires_at as string).getTime() < Date.now()) {
    // Mark as expired so the list view drops it.
    await supabase
      .from("opt_proposals")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", args.proposalId);
    return {
      ok: false,
      code: "EXPIRED",
      message:
        "Proposal expired. Regenerate against current data to approve.",
    };
  }

  // §10 guardrails — refuse to approve if the change_set fails.
  const guardrail = lintChangeSet({
    change_set: row.change_set as Record<string, unknown>,
    before_snapshot: row.before_snapshot as Record<string, unknown>,
    risk_level: row.risk_level as OptRiskLevel,
  });
  if (!guardrail.ok) {
    return {
      ok: false,
      code: "GUARDRAIL_FAILED",
      message: `Guardrails: ${guardrail.failures.join("; ")}`,
      guardrail,
    };
  }

  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("opt_proposals")
    .update({
      status: "approved",
      approved_at: nowIso,
      approved_by: args.approverUserId,
      pre_build_reprompt: args.preBuildReprompt ?? null,
      updated_at: nowIso,
      updated_by: args.approverUserId,
    })
    .eq("id", args.proposalId)
    .eq("status", "pending");
  if (updErr) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: updErr.message,
    };
  }

  await recordChangeLog({
    clientId: row.client_id as string,
    proposalId: args.proposalId,
    landingPageId: row.landing_page_id as string,
    event: "proposal_approved",
    actorUserId: args.approverUserId,
    details: {
      pre_build_reprompt: args.preBuildReprompt ?? null,
      guardrail_warnings: guardrail.warnings,
    },
  });

  // OPTIMISER-15: brief submission integration.
  // Approve fires submit-brief synchronously. On success, flip the
  // proposal to `applying` so the UI starts polling /run-status. On
  // failure, leave the proposal at `approved` so staff can retry via
  // the manual handoff (the existing fallback) and surface the error
  // to the response so the operator sees what went wrong.
  const submitResult = await submitBriefForProposal({
    proposalId: args.proposalId,
    approverUserId: args.approverUserId,
  });
  if (!submitResult.ok) {
    return {
      ok: true,
      proposal_id: args.proposalId,
      brief_submitted: false,
      submit_error: submitResult.error,
    };
  }

  // Flip status approved → applying. CAS on status='approved' so a
  // race with another submitter doesn't double-fire.
  await supabase
    .from("opt_proposals")
    .update({
      status: "applying",
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.proposalId)
    .eq("status", "approved");

  return {
    ok: true,
    proposal_id: args.proposalId,
    brief_submitted: true,
    brief_id: submitResult.brief_id,
    brief_run_id: submitResult.brief_run_id,
    output_mode: submitResult.output_mode,
  };
}

export type RejectResult =
  | { ok: true; proposal_id: string; suppressed_now: boolean }
  | {
      ok: false;
      code: "STATUS_CONFLICT" | "INTERNAL_ERROR";
      message: string;
    };

export async function rejectProposal(args: {
  proposalId: string;
  rejecterUserId: string | null;
  reasonCode: "not_aligned_brand" | "offer_change_not_approved" | "bad_timing" | "design_conflict" | "other";
  reasonText?: string;
}): Promise<RejectResult> {
  const supabase = getServiceRoleClient();
  const { data: row, error } = await supabase
    .from("opt_proposals")
    .select("id, status, client_id, landing_page_id, triggering_playbook_id")
    .eq("id", args.proposalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`rejectProposal fetch: ${error.message}`);
  if (!row) {
    return {
      ok: false,
      code: "STATUS_CONFLICT",
      message: "Proposal not found",
    };
  }
  if (row.status !== "pending") {
    return {
      ok: false,
      code: "STATUS_CONFLICT",
      message: `Proposal is in status ${row.status}`,
    };
  }
  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("opt_proposals")
    .update({
      status: "rejected",
      rejected_at: nowIso,
      rejected_by: args.rejecterUserId,
      rejection_reason_code: args.reasonCode,
      rejection_reason_text: args.reasonText ?? null,
      updated_at: nowIso,
      updated_by: args.rejecterUserId,
    })
    .eq("id", args.proposalId)
    .eq("status", "pending");
  if (updErr) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: updErr.message,
    };
  }

  // Per-client memory: bump the rejected_pattern count.
  let suppressedNow = false;
  if (row.triggering_playbook_id) {
    suppressedNow = await recordRejection({
      clientId: row.client_id as string,
      playbookId: row.triggering_playbook_id as string,
      reasonCode: args.reasonCode,
      pageType: "landing",
      userId: args.rejecterUserId,
    });
  }

  await recordChangeLog({
    clientId: row.client_id as string,
    proposalId: args.proposalId,
    landingPageId: row.landing_page_id as string,
    event: "proposal_rejected",
    actorUserId: args.rejecterUserId,
    details: {
      reason_code: args.reasonCode,
      reason_text: args.reasonText ?? null,
      suppressed_now: suppressedNow,
    },
  });

  return { ok: true, proposal_id: args.proposalId, suppressed_now: suppressedNow };
}

/** Sweep proposals past expiry; idempotent. Daily cron-friendly. */
export async function expireStaleProposals(): Promise<{ expired: number }> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opt_proposals")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .lt("expires_at", new Date().toISOString())
    .in("status", ["pending", "approved"])
    .is("deleted_at", null)
    .select("id");
  if (error) {
    logger.error("optimiser.proposals.expire_failed", { error: error.message });
    throw new Error(`expireStaleProposals: ${error.message}`);
  }
  return { expired: (data ?? []).length };
}
