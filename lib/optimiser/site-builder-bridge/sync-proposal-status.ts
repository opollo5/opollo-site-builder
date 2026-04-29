import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 15 — Lazy proposal-status reconciliation.
//
// The brief-runner cron tick advances brief_runs.status (queued →
// running → succeeded | failed). The proposal status (`applying`)
// needs to follow. Rather than coupling the brief-runner to opt_*
// (which would add a circular dependency between two domains), this
// helper reconciles on demand: every poll of GET /run-status calls
// reconcile(), which reads the latest brief_run and writes the
// matching opt_proposals.status.
//
// State mapping:
//   brief_runs.status === 'succeeded' → opt_proposals.status = 'applied'
//   brief_runs.status === 'failed'    → opt_proposals.status = 'applied_then_failed'
//   anything else                     → no-op (proposal stays 'applying')
//
// Idempotent — re-running on a proposal already in 'applied' / 'applied_then_failed'
// is a noop (the WHERE status='applying' filter blocks the second update).
// ---------------------------------------------------------------------------

export interface RunStatusResult {
  proposal_id: string;
  proposal_status: string;
  brief_run_id: string | null;
  brief_run_status: string | null;
  brief_run_failure_code: string | null;
  brief_run_failure_detail: string | null;
}

export async function reconcileProposalRunStatus(
  proposalId: string,
): Promise<RunStatusResult> {
  const supabase = getServiceRoleClient();

  // Find the most-recent brief_run for this proposal. There should
  // typically be just one; multiple appear only if the operator
  // re-triggered after an applied_then_failed.
  const runRes = await supabase
    .from("brief_runs")
    .select("id, status, failure_code, failure_detail")
    .eq("triggered_by_proposal_id", proposalId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runRes.error) {
    throw new Error(`brief_runs lookup: ${runRes.error.message}`);
  }

  const proposalRes = await supabase
    .from("opt_proposals")
    .select("id, status")
    .eq("id", proposalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (proposalRes.error) {
    throw new Error(`opt_proposals lookup: ${proposalRes.error.message}`);
  }
  if (!proposalRes.data) {
    throw new Error("proposal not found");
  }

  const currentProposalStatus = proposalRes.data.status as string;
  const run = runRes.data;

  // No brief_run yet — proposal stays as-is.
  if (!run) {
    return {
      proposal_id: proposalId,
      proposal_status: currentProposalStatus,
      brief_run_id: null,
      brief_run_status: null,
      brief_run_failure_code: null,
      brief_run_failure_detail: null,
    };
  }

  // Reconcile only when proposal is in `applying` and run is terminal.
  let nextStatus: string | null = null;
  if (currentProposalStatus === "applying") {
    if (run.status === "succeeded") nextStatus = "applied";
    else if (run.status === "failed") nextStatus = "applied_then_failed";
  }

  if (nextStatus) {
    const updRes = await supabase
      .from("opt_proposals")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposalId)
      .eq("status", "applying"); // CAS — only update if still applying
    if (updRes.error) {
      logger.error("sync-proposal-status: status update failed", {
        proposal_id: proposalId,
        next_status: nextStatus,
        err: updRes.error.message,
      });
    }
  }

  return {
    proposal_id: proposalId,
    proposal_status: nextStatus ?? currentProposalStatus,
    brief_run_id: run.id as string,
    brief_run_status: run.status as string,
    brief_run_failure_code:
      (run.failure_code as string | null) ?? null,
    brief_run_failure_detail:
      (run.failure_detail as string | null) ?? null,
  };
}
