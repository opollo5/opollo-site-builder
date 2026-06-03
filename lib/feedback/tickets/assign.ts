import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

type AssignResult =
  | { ok: true }
  | { ok: false; error: string };

export async function assignTicket(
  ticketId: string,
  assigneeId: string | null,
  actorUserId: string,
): Promise<AssignResult> {
  const svc = getServiceRoleClient();

  // Verify the ticket exists and get current assignee for event log.
  const { data: ticket, error: ticketErr } = await svc
    .from("feedback_tickets")
    .select("id, assignee_id, company_id")
    .eq("id", ticketId)
    .is("deleted_at", null)
    .maybeSingle();
  if (ticketErr || !ticket) {
    return { ok: false, error: "Ticket not found." };
  }

  // If assigning (not clearing), the assignee must be Opollo staff.
  if (assigneeId !== null) {
    const { data: assignee, error: ae } = await svc
      .from("platform_users")
      .select("id, is_opollo_staff")
      .eq("id", assigneeId)
      .maybeSingle();
    if (ae || !assignee) return { ok: false, error: "Assignee not found." };
    if (!assignee.is_opollo_staff) {
      return { ok: false, error: "Assignee must be Opollo staff." };
    }
  }

  const prevAssigneeId = ticket.assignee_id as string | null;
  const eventType = prevAssigneeId ? "reassigned" : "assigned";

  const { error: updateErr } = await svc
    .from("feedback_tickets")
    .update({ assignee_id: assigneeId, updated_by: actorUserId })
    .eq("id", ticketId);
  if (updateErr) {
    logger.error("feedback.assign.failed", { ticket_id: ticketId, err: updateErr.message });
    return { ok: false, error: updateErr.message };
  }

  await svc.from("feedback_ticket_events").insert({
    ticket_id: ticketId,
    event_type: eventType,
    from_value: prevAssigneeId,
    to_value: assigneeId,
    actor_id: actorUserId,
    actor_kind: "human-staff",
  });

  logger.info("feedback.assign.ok", {
    ticket_id: ticketId,
    prev_assignee: prevAssigneeId,
    new_assignee: assigneeId,
    actor: actorUserId,
  });

  return { ok: true };
}
