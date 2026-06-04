import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import type { CreateTicketInput, FeedbackTicket } from "../types";
import { notifyTicketCreated } from "./notify";

type CreateResult =
  | { ok: true; ticket: FeedbackTicket }
  | { ok: false; error: string };

export async function createTicket(
  input: CreateTicketInput,
  createdByUserId: string,
): Promise<CreateResult> {
  const svc = getServiceRoleClient();

  // Assignee validation: if provided, the assignee must be Opollo staff.
  if (input.assigneeId) {
    const { data: assignee, error: assigneeErr } = await svc
      .from("platform_users")
      .select("id, is_opollo_staff")
      .eq("id", input.assigneeId)
      .maybeSingle();
    if (assigneeErr || !assignee) {
      return { ok: false, error: "Assignee not found." };
    }
    if (!assignee.is_opollo_staff) {
      return { ok: false, error: "Assignee must be Opollo staff." };
    }
  }

  const { data, error } = await svc
    .from("feedback_tickets")
    .insert({
      company_id: input.companyId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      priority: "medium",
      status: "backlog",
      tags: input.tags ?? [],
      assignee_id: input.assigneeId ?? null,
      page_url: input.pageUrl,
      route_pattern: input.routePattern ?? null,
      css_selector: input.cssSelector,
      element_label: input.elementLabel ?? null,
      click_x_pct: input.clickXPct,
      click_y_pct: input.clickYPct,
      viewport_w: input.viewportW,
      viewport_h: input.viewportH,
      device_pixel_ratio: input.devicePixelRatio ?? null,
      user_agent: input.userAgent ?? null,
      console_errors: input.consoleErrors ?? null,
      screenshot_path: input.screenshotObjectPath ?? null,
      created_by: createdByUserId,
      updated_by: createdByUserId,
    })
    .select("*")
    .single();

  if (error) {
    logger.error("feedback.create.failed", {
      company_id: input.companyId,
      created_by: createdByUserId,
      err: error.message,
    });
    return { ok: false, error: error.message };
  }

  const ticket = data as FeedbackTicket;

  // Append created event (service role; append-only).
  await svc.from("feedback_ticket_events").insert({
    ticket_id: ticket.id,
    event_type: "created",
    from_value: null,
    to_value: "backlog",
    actor_id: createdByUserId,
    actor_kind: "human-staff",
  });

  logger.info("feedback.create.ok", {
    ticket_id: ticket.id,
    company_id: input.companyId,
    severity: input.severity,
    created_by: createdByUserId,
  });

  // Fire-and-forget notification (blocker emails are immediate per §8).
  void notifyTicketCreated(ticket);

  return { ok: true, ticket };
}
