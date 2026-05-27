import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { dbUuid, readJsonBody, validationError, notFound, invalidState, internalError } from "@/lib/http";
import { dispatch } from "@/lib/platform/notifications";
import { approvePost } from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

// S1-48 — POST /api/platform/social/posts/[id]/approve
// Transitions pending_client_approval → approved for platform users with
// the approver role (or Opollo staff bypass). Gate: canDo("approve_post").
// S1-51 — fires approval_decided notification to post creator + company admins.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const Schema = z.object({ company_id: dbUuid() });

function errorForCode(code: string, message: string): NextResponse {
  switch (code) {
    case "VALIDATION_FAILED": return validationError(message);
    case "NOT_FOUND": return notFound(message);
    case "INVALID_STATE": return invalidState(message);
    default: return internalError(message);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return validationError("Body must be { company_id: uuid }.");

  const gate = await requireCanDoForApi(parsed.data.company_id, "approve_post");
  if (gate.kind === "deny") return gate.response;

  // V2 dispatch: pending_approval → scheduled (OD-1: V1 "approved" = V2 "scheduled").
  const svc = getServiceRoleClient();
  const { data: v2draft } = await svc
    .from("social_post_drafts")
    .select("id, state, created_by")
    .eq("id", id)
    .eq("company_id", parsed.data.company_id)
    .maybeSingle();

  if (v2draft) {
    if ((v2draft.state as string) !== "pending_approval") {
      return invalidState(`Draft is in state '${v2draft.state as string}', expected 'pending_approval'.`);
    }
    const { error } = await svc
      .from("social_post_drafts")
      .update({ state: "scheduled", updated_by: gate.userId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", parsed.data.company_id)
      .eq("state", "pending_approval");
    if (error) return internalError(`Failed to approve draft: ${error.message}`);

    const createdBy = v2draft.created_by as string | null;
    if (createdBy) {
      void dispatch({
        event: "approval_decided",
        companyId: parsed.data.company_id,
        postMasterId: id,
        submitterUserId: createdBy,
        decision: "approved",
      });
    }
    return NextResponse.json(
      { ok: true, data: { id, state: "scheduled" }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  // V1 fallback.
  const result = await approvePost({ postId: id, companyId: parsed.data.company_id });
  if (!result.ok) return errorForCode(result.error.code, result.error.message);

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
