import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";
import { dbUuid, internalError, notFound, readJsonBody, validationError } from "@/lib/http";
import { isOpolloStaff } from "@/lib/platform/auth";
import { getTicket, listComments, listEvents } from "@/lib/feedback/tickets/queries";
import { assignTicket } from "@/lib/feedback/tickets/assign";
import { updateTicketStatus } from "@/lib/feedback/tickets/update-status";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { TicketPriority, TicketSeverity, TicketStatus } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// GET  /api/feedback/tickets/[id]  — get one ticket + comments + events
// PATCH /api/feedback/tickets/[id] — update status/assignee/severity/priority (staff only)
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  status: z.enum(["backlog", "triaged", "in_progress", "fixed", "verified", "wont_fix", "closed"]).optional(),
  assigneeId: dbUuid().nullable().optional(),
  severity: z.enum(["low", "normal", "high", "blocker"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  tags: z.array(z.string()).optional(),
}).strict();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }

  const ticket = await getTicket(id);
  if (!ticket) return notFound("Ticket not found.");

  // Visibility check: staff see all; members see own company.
  const staff = await isOpolloStaff(supabase);
  if (!staff) {
    const { data: membership } = await supabase.rpc("is_company_member", { company: ticket.company_id });
    if (!membership) {
      return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
    }
  }

  const [comments, events] = await Promise.all([
    listComments(id),
    listEvents(id),
  ]);

  return NextResponse.json(
    { ok: true, data: { ticket, comments, events }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  const userId = userResp.user.id;

  // PATCH is staff-only.
  const staff = await isOpolloStaff(supabase);
  if (!staff) {
    return NextResponse.json({ ok: false, error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid patch payload.", { issues: parsed.error.issues });
  }

  const { status, assigneeId, severity, priority, tags } = parsed.data;

  // Status change goes through the state machine.
  if (status !== undefined) {
    const statusResult = await updateTicketStatus(
      id,
      status as TicketStatus,
      { kind: "human-staff", userId },
    );
    if (!statusResult.ok) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_STATE", message: statusResult.error } },
        { status: 409 },
      );
    }
  }

  // Assignee change.
  if (assigneeId !== undefined) {
    const assignResult = await assignTicket(id, assigneeId, userId);
    if (!assignResult.ok) {
      return NextResponse.json(
        { ok: false, error: { code: "VALIDATION_FAILED", message: assignResult.error } },
        { status: 400 },
      );
    }
  }

  // Severity / priority / tags — direct update with event writes.
  const svc = getServiceRoleClient();
  const updates: Record<string, unknown> = { updated_by: userId };
  const events: Array<{ event_type: string; from_value: string | null; to_value: string }> = [];

  if (severity !== undefined || priority !== undefined || tags !== undefined) {
    const { data: cur } = await svc
      .from("feedback_tickets")
      .select("severity, priority, tags")
      .eq("id", id)
      .maybeSingle();

    if (severity !== undefined && cur?.severity !== severity) {
      updates.severity = severity;
      events.push({ event_type: "severity_changed", from_value: cur?.severity ?? null, to_value: severity });
    }
    if (priority !== undefined && cur?.priority !== priority) {
      updates.priority = priority;
      events.push({ event_type: "priority_changed", from_value: cur?.priority ?? null, to_value: priority });
    }
    if (tags !== undefined) {
      updates.tags = tags;
    }

    if (Object.keys(updates).length > 1) {
      const { error: upErr } = await svc
        .from("feedback_tickets")
        .update(updates)
        .eq("id", id);
      if (upErr) {
        logger.error("feedback.patch.update_failed", { ticket_id: id, err: upErr.message });
        return internalError(upErr.message);
      }
    }

    for (const ev of events) {
      await svc.from("feedback_ticket_events").insert({
        ticket_id: id,
        event_type: ev.event_type,
        from_value: ev.from_value,
        to_value: ev.to_value,
        actor_id: userId,
        actor_kind: "human-staff",
      });
    }
  }

  const ticket = await getTicket(id);
  return NextResponse.json(
    { ok: true, data: { ticket }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
