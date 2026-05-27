import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, notFound, invalidState, internalError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { cancelApprovalRequest } from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-10 — POST /api/platform/social/posts/[id]/cancel-approval
//
// Atomically revokes the open approval_request, flips the post back
// to draft, and writes a 'revoked' audit event tied to the canceller.
// Migration 0073 wraps the three writes in one Postgres function so
// the invariant "post in draft → no open request, audit event recorded"
// holds even under concurrent cancel attempts.
//
// Gate: canDo("edit_post", company_id) — same threshold as edit/delete.
// The cancellation is an editorial recovery move, not a user-management
// one.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const Schema = z.object({
  company_id: dbUuid(),
  reason: z.string().max(2000).nullable().optional(),
});

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
  if (!UUID_RE.test(id)) {
    return validationError("id must be a UUID.");
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { company_id: uuid, reason?: string }.");
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "edit_post");
  if (gate.kind === "deny") return gate.response;

  // V2 dispatch: pending_approval → draft.
  const svc = getServiceRoleClient();
  const { data: v2draft } = await svc
    .from("social_post_drafts")
    .select("id, state")
    .eq("id", id)
    .eq("company_id", parsed.data.company_id)
    .maybeSingle();

  if (v2draft) {
    if ((v2draft.state as string) !== "pending_approval") {
      return invalidState(`Draft is in state '${v2draft.state as string}', expected 'pending_approval'.`);
    }
    const { error } = await svc
      .from("social_post_drafts")
      .update({ state: "draft", updated_by: gate.userId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", parsed.data.company_id)
      .eq("state", "pending_approval");
    if (error) return internalError(`Failed to cancel approval: ${error.message}`);
    return NextResponse.json(
      { ok: true, data: { id, state: "draft" }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  // V1 fallback.
  const result = await cancelApprovalRequest({
    postId: id,
    companyId: parsed.data.company_id,
    actorUserId: gate.userId,
    reason: parsed.data.reason ?? null,
  });
  if (!result.ok) {
    return errorForCode(result.error.code, result.error.message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
