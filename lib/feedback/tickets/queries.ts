import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import type { FeedbackTicket, FeedbackTicketComment, FeedbackTicketEvent } from "../types";

// ---------------------------------------------------------------------------
// Queries — list/get with RLS-appropriate scoping.
// Service-role is used here so the caller can pass an explicit companyId
// filter for members, or omit it for staff (cross-company). The RLS layer
// is enforced at the API boundary; these functions are internal lib helpers.
// ---------------------------------------------------------------------------

export type ListTicketsOptions = {
  companyId?: string;
  status?: string;
  severity?: string;
  priority?: string;
  assigneeId?: string;
  hasPr?: boolean;
};

export async function listTickets(
  opts: ListTicketsOptions,
): Promise<FeedbackTicket[]> {
  const svc = getServiceRoleClient();
  let q = svc
    .from("feedback_tickets")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.severity) q = q.eq("severity", opts.severity);
  if (opts.priority) q = q.eq("priority", opts.priority);
  if (opts.assigneeId) q = q.eq("assignee_id", opts.assigneeId);
  if (opts.hasPr === true) q = q.not("linked_pr_url", "is", null);
  if (opts.hasPr === false) q = q.is("linked_pr_url", null);

  const { data, error } = await q;
  if (error) {
    logger.error("feedback.queries.list_failed", { err: error.message, opts });
    return [];
  }
  return (data ?? []) as FeedbackTicket[];
}

export async function getTicket(id: string): Promise<FeedbackTicket | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("feedback_tickets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error("feedback.queries.get_failed", { ticket_id: id, err: error.message });
    return null;
  }
  return data as FeedbackTicket | null;
}

export async function listComments(ticketId: string): Promise<FeedbackTicketComment[]> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("feedback_ticket_comments")
    .select("*")
    .eq("ticket_id", ticketId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) {
    logger.error("feedback.queries.comments_failed", { ticket_id: ticketId, err: error.message });
    return [];
  }
  return (data ?? []) as FeedbackTicketComment[];
}

// The Opollo-internal company sentinel UUID (migration 0070).
// Tickets from this company are filed by Opollo staff; no company label needed.
const OPOLLO_INTERNAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

// Resolve company_ids to display names for the admin board.
// Returns an empty string for the Opollo-internal sentinel (label not needed).
export async function resolveCompanyNames(
  companyIds: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(companyIds.filter((id) => id !== OPOLLO_INTERNAL_COMPANY_ID))];
  if (unique.length === 0) return new Map();
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("platform_companies")
    .select("id, name")
    .in("id", unique);
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.id as string, row.name as string);
  }
  return map;
}

// All Opollo staff — used to populate the assignee picker on ticket detail.
export async function listOpolloStaff(): Promise<
  Array<{ id: string; fullName: string | null; email: string }>
> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("platform_users")
    .select("id, full_name, email")
    .eq("is_opollo_staff", true)
    .order("full_name", { ascending: true });
  return (data ?? []).map((u) => ({
    id: u.id as string,
    fullName: (u.full_name as string | null) ?? null,
    email: u.email as string,
  }));
}

// Resolve actor_id values to display names for the event timeline.
// Goes through the platform layer (service-role client pattern) without
// importing platform_users directly — consistent with the rest of lib/feedback.
export async function resolveActorNames(
  actorIds: (string | null)[],
): Promise<Map<string, string>> {
  const ids = actorIds.filter((id): id is string => id !== null);
  if (ids.length === 0) return new Map();
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("platform_users")
    .select("id, full_name, email")
    .in("id", ids);
  const map = new Map<string, string>();
  for (const u of data ?? []) {
    const display = (u.full_name as string | null)?.trim() || (u.email as string);
    map.set(u.id as string, display);
  }
  return map;
}

export async function listEvents(ticketId: string): Promise<FeedbackTicketEvent[]> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("feedback_ticket_events")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) {
    logger.error("feedback.queries.events_failed", { ticket_id: ticketId, err: error.message });
    return [];
  }
  return (data ?? []) as FeedbackTicketEvent[];
}
