import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";
import { internalError, readJsonBody } from "@/lib/http";
import { addComment } from "@/lib/feedback/tickets/comments";
import { updateTicketStatus } from "@/lib/feedback/tickets/update-status";
import { getTicket } from "@/lib/feedback/tickets/queries";
import { notifyReopenedByCustomer } from "@/lib/feedback/tickets/notify";

// ---------------------------------------------------------------------------
// POST /api/feedback/tickets/[id]/reopen — "Still broken" controlled reopen.
//
// Only allowed to a member of the ticket's own company when status is
// fixed or verified. Calls update-status.ts with customer-reporter context
// via the service-role path (the RLS UPDATE policy is staff-only; we
// validate membership here then use service role).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ReopenSchema = z.object({
  comment: z.string().max(2000).optional(),
});

export async function POST(
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

  // Validate body.
  const body = await readJsonBody(req);
  const parsed = ReopenSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED" } }, { status: 400 });
  }

  // Load the ticket (service role — the RLS update policy is staff-only, so
  // we need service role for the write path. For the read, use service role
  // too and validate company membership explicitly).
  const ticket = await getTicket(id);
  if (!ticket || ticket.deleted_at) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  // Membership check: the caller must be a member of the ticket's company.
  const { data: memberCheck } = await supabase.rpc("is_company_member", {
    company: ticket.company_id,
  });
  if (!memberCheck) {
    return NextResponse.json({ ok: false, error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  // Status must be fixed or verified.
  if (ticket.status !== "fixed" && ticket.status !== "verified") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_STATE",
          message: `"Still broken" is only available when the ticket status is fixed or verified (current: ${ticket.status}).`,
        },
      },
      { status: 409 },
    );
  }

  // Drive the transition with customer-reporter context (service role write).
  let statusResult: Awaited<ReturnType<typeof updateTicketStatus>>;
  try {
    statusResult = await updateTicketStatus(id, "in_progress", {
      kind: "customer-reporter",
      userId,
    });
  } catch (err) {
    // update-status.ts throws on unauthorized transition.
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: String(err) } },
      { status: 403 },
    );
  }

  if (!statusResult.ok) {
    return internalError(statusResult.error);
  }

  // Post the optional comment.
  if (parsed.data.comment?.trim()) {
    await addComment(id, parsed.data.comment.trim(), userId);
  }

  const updated = await getTicket(id);

  // Notify assignee + Opollo staff that the ticket was reopened.
  if (updated) void notifyReopenedByCustomer(updated);
  return NextResponse.json(
    { ok: true, data: { ticket: updated }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
