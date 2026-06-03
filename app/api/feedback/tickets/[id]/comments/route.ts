import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";
import { internalError, readJsonBody, validationError } from "@/lib/http";
import { isCompanyMember, isOpolloStaff } from "@/lib/platform/auth";
import { addComment } from "@/lib/feedback/tickets/comments";
import { getTicket, listComments } from "@/lib/feedback/tickets/queries";

// ---------------------------------------------------------------------------
// POST /api/feedback/tickets/[id]/comments — add a comment (member or staff)
// GET  /api/feedback/tickets/[id]/comments — list thread
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CommentSchema = z.object({ body: z.string().min(1).max(2000) });

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

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = CommentSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("body is required (max 2000 chars).", { issues: parsed.error.issues });
  }

  // Verify ticket visibility.
  const ticket = await getTicket(id);
  if (!ticket || ticket.deleted_at) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const [member, staff] = await Promise.all([
    isCompanyMember(ticket.company_id, supabase),
    isOpolloStaff(supabase),
  ]);
  if (!member && !staff) {
    return NextResponse.json({ ok: false, error: { code: "FORBIDDEN" } }, { status: 403 });
  }

  const result = await addComment(id, parsed.data.body, userId);
  if (!result.ok) return internalError(result.error);

  return NextResponse.json(
    { ok: true, data: { comment: result.comment }, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}

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
  if (!ticket || ticket.deleted_at) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const [member, staff] = await Promise.all([
    isCompanyMember(ticket.company_id, supabase),
    isOpolloStaff(supabase),
  ]);
  if (!member && !staff) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const comments = await listComments(id);
  return NextResponse.json(
    { ok: true, data: { comments }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
