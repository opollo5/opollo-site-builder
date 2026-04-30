import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// opt_change_log helpers (spec §5.1, §9.8.2, §11.1).
// ---------------------------------------------------------------------------

export type ChangeLogEvent =
  | "proposal_approved"
  | "proposal_rejected"
  | "proposal_submitted"
  | "page_regenerated"
  | "page_state_transition"
  | "manual_rollback"
  | "rolled_back"
  | "reverted"
  | "reprompted"
  | "staged_rollout_started"
  | "staged_rollout_promoted"
  | "staged_rollout_auto_reverted"
  | "staged_rollout_window_expired"
  | "ab_winner_promoted"
  | "ab_test_inconclusive"
  | "assisted_approval_toggled"
  | "cross_client_learning_consent_toggled";

export type ChangeLogRow = {
  id: number;
  client_id: string;
  proposal_id: string | null;
  landing_page_id: string | null;
  event: string;
  brief_id: string | null;
  page_id: string | null;
  page_version: string | null;
  details: Record<string, unknown>;
  actor_user_id: string | null;
  created_at: string;
};

export async function recordChangeLog(args: {
  clientId: string;
  event: ChangeLogEvent;
  proposalId?: string | null;
  landingPageId?: string | null;
  briefId?: string | null;
  pageId?: string | null;
  pageVersion?: string | null;
  details?: Record<string, unknown>;
  actorUserId?: string | null;
}): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("opt_change_log").insert({
    client_id: args.clientId,
    event: args.event,
    proposal_id: args.proposalId ?? null,
    landing_page_id: args.landingPageId ?? null,
    brief_id: args.briefId ?? null,
    page_id: args.pageId ?? null,
    page_version: args.pageVersion ?? null,
    details: args.details ?? {},
    actor_user_id: args.actorUserId ?? null,
  });
  if (error) {
    logger.error("optimiser.change_log.insert_failed", {
      event: args.event,
      client_id: args.clientId,
      error: error.message,
    });
  }
}

export async function listChangeLog(args: {
  clientId?: string;
  landingPageId?: string;
  proposalId?: string;
  limit?: number;
}): Promise<ChangeLogRow[]> {
  const supabase = getServiceRoleClient();
  let q = supabase
    .from("opt_change_log")
    .select(
      "id, client_id, proposal_id, landing_page_id, event, brief_id, page_id, page_version, details, actor_user_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 200);
  if (args.clientId) q = q.eq("client_id", args.clientId);
  if (args.landingPageId) q = q.eq("landing_page_id", args.landingPageId);
  if (args.proposalId) q = q.eq("proposal_id", args.proposalId);
  const { data, error } = await q;
  if (error) throw new Error(`listChangeLog: ${error.message}`);
  return (data ?? []) as ChangeLogRow[];
}

/**
 * Manual rollback (§9.10). Phase 1 doesn't yet apply pages through
 * the Site Builder (Phase 1.5 wires the brief submission), so the
 * "rollback" here is the proposal-side bookkeeping: flip the proposal
 * to applied_then_reverted and write a manual_rollback log row. When
 * Phase 1.5 lands, the same handler will additionally call the Site
 * Builder rollback endpoint to restore the previous page version.
 */
export async function manualRollbackProposal(args: {
  proposalId: string;
  actorUserId: string | null;
  reason: string;
}): Promise<{ ok: boolean; message?: string }> {
  const supabase = getServiceRoleClient();
  const { data: row, error } = await supabase
    .from("opt_proposals")
    .select("id, status, client_id, landing_page_id")
    .eq("id", args.proposalId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  if (!row) return { ok: false, message: "Proposal not found" };
  if (row.status !== "approved" && row.status !== "applied" && row.status !== "applied_promoted") {
    return {
      ok: false,
      message: `Proposal is in status ${row.status} — nothing to roll back`,
    };
  }
  const nowIso = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("opt_proposals")
    .update({
      status: "applied_then_reverted",
      updated_at: nowIso,
      updated_by: args.actorUserId,
    })
    .eq("id", args.proposalId);
  if (updErr) return { ok: false, message: updErr.message };

  await recordChangeLog({
    clientId: row.client_id as string,
    proposalId: args.proposalId,
    landingPageId: row.landing_page_id as string,
    event: "manual_rollback",
    actorUserId: args.actorUserId,
    details: { reason: args.reason },
  });
  return { ok: true };
}
