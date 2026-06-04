import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import type { CallerContext, TicketStatus } from "../types";

// ---------------------------------------------------------------------------
// State machine — single source of truth for all status transitions.
//
// Caller context guards (§1 of build spec, non-negotiable):
//   human-staff    → any transition
//   automation     → only in_progress | fixed
//   customer-reporter → only {fixed,verified} → in_progress (controlled reopen)
//
// verified_by / verified_at are set ONLY on a human-staff transition to
// verified. If any other caller attempts to set verified, the guard throws
// and logs — it does NOT silently succeed.
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: TicketStatus[] = ["verified", "closed", "wont_fix"];

// Allowed (from → to) pairs. Any unlisted pair is rejected.
// Spec (§7): backlog → triaged → in_progress → fixed → verified → closed
//            any → wont_fix → closed
//            fixed|verified → in_progress  (reopen)
// v1.1 §5: human-staff may also move any non-closed ticket back to backlog
//          or directly to wont_fix (triage actions on the detail page).
const TRANSITIONS: Map<TicketStatus, TicketStatus[]> = new Map([
  ["backlog",     ["triaged", "in_progress", "wont_fix"]],
  ["triaged",     ["backlog", "in_progress", "wont_fix"]],
  ["in_progress", ["backlog", "fixed", "wont_fix"]],
  ["fixed",       ["backlog", "in_progress", "verified", "wont_fix"]],
  ["verified",    ["backlog", "in_progress", "closed", "wont_fix"]],
  ["wont_fix",    ["backlog", "closed"]],
  ["closed",      []],
]);

type UpdateStatusResult =
  | { ok: true; status: TicketStatus }
  | { ok: false; error: string };

export async function updateTicketStatus(
  ticketId: string,
  toStatus: TicketStatus,
  caller: CallerContext,
): Promise<UpdateStatusResult> {
  const svc = getServiceRoleClient();

  // Load the current ticket.
  const { data: ticket, error: ticketErr } = await svc
    .from("feedback_tickets")
    .select("id, status, company_id, assignee_id")
    .eq("id", ticketId)
    .is("deleted_at", null)
    .maybeSingle();

  if (ticketErr || !ticket) {
    return { ok: false, error: "Ticket not found." };
  }

  const fromStatus = ticket.status as TicketStatus;

  // -------------------------------------------------------------------------
  // 1. Validate the caller's permission to make this transition.
  // -------------------------------------------------------------------------
  if (caller.kind === "automation") {
    // Automation may only move to in_progress or fixed.
    if (toStatus !== "in_progress" && toStatus !== "fixed") {
      const msg = `Automation caller rejected: cannot set status '${toStatus}' (only in_progress|fixed allowed).`;
      logger.error("feedback.update_status.automation_terminal_rejected", {
        ticket_id: ticketId,
        to_status: toStatus,
      });
      throw new Error(msg);
    }
  }

  if (caller.kind === "customer-reporter") {
    // Customers may only perform the controlled reopen: {fixed,verified} → in_progress.
    if (
      toStatus !== "in_progress" ||
      (fromStatus !== "fixed" && fromStatus !== "verified")
    ) {
      const msg = `Customer-reporter rejected: only {fixed,verified} → in_progress is allowed (attempted ${fromStatus} → ${toStatus}).`;
      logger.error("feedback.update_status.customer_reporter_rejected", {
        ticket_id: ticketId,
        from_status: fromStatus,
        to_status: toStatus,
        actor: caller.userId,
      });
      throw new Error(msg);
    }
  }

  // -------------------------------------------------------------------------
  // 2. Validate the transition is in the state machine.
  // -------------------------------------------------------------------------
  const allowed = TRANSITIONS.get(fromStatus) ?? [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      error: `Transition ${fromStatus} → ${toStatus} is not permitted.`,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Apply the transition.
  // -------------------------------------------------------------------------
  const actorId =
    caller.kind === "automation" ? null : caller.userId;
  const actorKind = caller.kind;

  const updateFields: Record<string, unknown> = {
    status: toStatus,
    updated_by: actorId,
  };

  // verified_by / verified_at only on a human-staff → verified transition.
  if (toStatus === "verified" && caller.kind === "human-staff") {
    updateFields.verified_by = caller.userId;
    updateFields.verified_at = new Date().toISOString();
  }

  // triaged_by / triaged_at on a human-staff → triaged transition.
  if (toStatus === "triaged" && caller.kind === "human-staff") {
    updateFields.triaged_by = caller.userId;
    updateFields.triaged_at = new Date().toISOString();
  }

  const { error: updateErr } = await svc
    .from("feedback_tickets")
    .update(updateFields)
    .eq("id", ticketId);

  if (updateErr) {
    logger.error("feedback.update_status.failed", {
      ticket_id: ticketId,
      err: updateErr.message,
    });
    return { ok: false, error: updateErr.message };
  }

  // -------------------------------------------------------------------------
  // 4. Write audit event.
  // -------------------------------------------------------------------------
  const eventType =
    caller.kind === "customer-reporter" ? "reopened_by_customer" :
    toStatus === "verified"             ? "verified"             :
    toStatus === "closed"               ? "closed"               :
    "status_changed";

  await svc.from("feedback_ticket_events").insert({
    ticket_id: ticketId,
    event_type: eventType,
    from_value: fromStatus,
    to_value: toStatus,
    actor_id: actorId,
    actor_kind: actorKind,
  });

  logger.info("feedback.update_status.ok", {
    ticket_id: ticketId,
    from_status: fromStatus,
    to_status: toStatus,
    actor_kind: actorKind,
    actor_id: actorId,
  });

  return { ok: true, status: toStatus };
}

// Re-export for convenience.
export { TERMINAL_STATUSES };
