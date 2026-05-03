import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { dispatch } from "@/lib/platform/notifications";
import { approvePost } from "@/lib/platform/social/posts";

// S1-48 — POST /api/platform/social/posts/[id]/approve
// Transitions pending_client_approval → approved for platform users with
// the approver role (or Opollo staff bypass). Gate: canDo("approve_post").
// S1-51 — fires approval_decided notification to post creator + company admins.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const Schema = z.object({ company_id: z.string().uuid() });

function errorJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable: false }, timestamp: new Date().toISOString() },
    { status },
  );
}

function statusForCode(code: string): number {
  switch (code) {
    case "VALIDATION_FAILED": return 400;
    case "NOT_FOUND": return 404;
    case "INVALID_STATE": return 409;
    default: return 500;
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);

  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return errorJson("VALIDATION_FAILED", "Body must be { company_id: uuid }.", 400);

  const gate = await requireCanDoForApi(parsed.data.company_id, "approve_post");
  if (gate.kind === "deny") return gate.response;

  const result = await approvePost({ postId: id, companyId: parsed.data.company_id });
  if (!result.ok) return errorJson(result.error.code, result.error.message, statusForCode(result.error.code));

  if (result.data.createdBy) {
    void dispatch({
      event: "approval_decided",
      companyId: parsed.data.company_id,
      postMasterId: id,
      submitterUserId: result.data.createdBy,
      decision: "approved",
    });
  }

  return NextResponse.json({ ok: true, data: result.data, timestamp: new Date().toISOString() }, { status: 200 });
}
