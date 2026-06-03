import "server-only";

import { dispatch } from "@/lib/platform/notifications/dispatch";
import { logger } from "@/lib/logger";

import type { FeedbackTicket } from "../types";

// ---------------------------------------------------------------------------
// Thin wrappers that call the notification dispatcher for feedback events.
// Notifications are fire-and-forget (failures logged, not surfaced to caller).
// ---------------------------------------------------------------------------

export async function notifyTicketCreated(ticket: FeedbackTicket): Promise<void> {
  try {
    await dispatch({
      event: "ticket_created",
      companyId: ticket.company_id,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      severity: ticket.severity,
      reporterUserId: ticket.created_by,
    });
  } catch (err) {
    logger.error("feedback.notify.ticket_created_failed", {
      ticket_id: ticket.id,
      err: String(err),
    });
  }
}

export async function notifyCommentAdded(
  ticket: FeedbackTicket,
  authorUserId: string,
  isStaffAuthor: boolean,
): Promise<void> {
  try {
    await dispatch({
      event: "ticket_comment_added",
      companyId: ticket.company_id,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      authorUserId,
      isStaffAuthor,
      assigneeUserId: ticket.assignee_id,
      reporterUserId: ticket.created_by,
    });
  } catch (err) {
    logger.error("feedback.notify.comment_added_failed", {
      ticket_id: ticket.id,
      err: String(err),
    });
  }
}

export async function notifyStatusChanged(
  ticket: FeedbackTicket,
  fromStatus: string,
  toStatus: string,
): Promise<void> {
  // Only email on fixed/verified (per §8 of spec).
  const emailStatuses = ["fixed", "verified"];
  if (!emailStatuses.includes(toStatus)) return;

  try {
    await dispatch({
      event: "ticket_status_changed",
      companyId: ticket.company_id,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      fromStatus,
      toStatus,
      reporterUserId: ticket.created_by,
    });
  } catch (err) {
    logger.error("feedback.notify.status_changed_failed", {
      ticket_id: ticket.id,
      err: String(err),
    });
  }
}

export async function notifyReopenedByCustomer(
  ticket: FeedbackTicket,
): Promise<void> {
  try {
    await dispatch({
      event: "ticket_reopened_by_customer",
      companyId: ticket.company_id,
      ticketId: ticket.id,
      ticketTitle: ticket.title,
      reporterUserId: ticket.created_by,
      assigneeUserId: ticket.assignee_id,
    });
  } catch (err) {
    logger.error("feedback.notify.reopened_by_customer_failed", {
      ticket_id: ticket.id,
      err: String(err),
    });
  }
}
