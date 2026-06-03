import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { isOpolloStaff } from "@/lib/platform/auth";
import { logger } from "@/lib/logger";

import type { FeedbackTicketComment } from "../types";

type AddCommentResult =
  | { ok: true; comment: FeedbackTicketComment }
  | { ok: false; error: string };

export async function addComment(
  ticketId: string,
  body: string,
  authorUserId: string,
): Promise<AddCommentResult> {
  const svc = getServiceRoleClient();

  // Verify the ticket is accessible (not deleted).
  const { data: ticket, error: ticketErr } = await svc
    .from("feedback_tickets")
    .select("id")
    .eq("id", ticketId)
    .is("deleted_at", null)
    .maybeSingle();
  if (ticketErr || !ticket) {
    return { ok: false, error: "Ticket not found." };
  }

  // is_staff is derived server-side — never accepted from the client.
  // We call is_opollo_staff() via a service-role-adjacent approach: look up
  // the platform_users.is_opollo_staff column directly using service role.
  const { data: user } = await svc
    .from("platform_users")
    .select("is_opollo_staff")
    .eq("id", authorUserId)
    .maybeSingle();
  const isStaff = user?.is_opollo_staff === true;

  const { data, error } = await svc
    .from("feedback_ticket_comments")
    .insert({
      ticket_id: ticketId,
      body,
      author_id: authorUserId,
      is_staff: isStaff,
    })
    .select("*")
    .single();

  if (error) {
    logger.error("feedback.comments.add_failed", {
      ticket_id: ticketId,
      author: authorUserId,
      err: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true, comment: data as FeedbackTicketComment };
}
