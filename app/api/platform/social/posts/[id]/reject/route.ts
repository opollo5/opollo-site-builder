import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, internalError, invalidState, readJsonBody, respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { dispatch } from "@/lib/platform/notifications";
import { rejectPost } from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const Schema = z.object({
  company_id: dbUuid(),
  comment: z.string().max(1000).trim().nullish(),
});

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

  const gate = await requireCanDoForApi(parsed.data.company_id, "reject_post");
  if (gate.kind === "deny") return gate.response;

  // V2 dispatch: pending_approval → rejected.
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
      .update({ state: "rejected", updated_by: gate.userId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", parsed.data.company_id)
      .eq("state", "pending_approval");
    if (error) return internalError(`Failed to reject draft: ${error.message}`);

    const createdBy = v2draft.created_by as string | null;
    if (createdBy) {
      void dispatch({
        event: "approval_decided",
        companyId: parsed.data.company_id,
        postMasterId: id,
        submitterUserId: createdBy,
        decision: "rejected",
        comment: parsed.data.comment ?? undefined,
      });
    }
    return NextResponse.json(
      { ok: true, data: { id, state: "rejected" }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  // V1 fallback.
  const comment = parsed.data.comment ?? null;
  const result = await rejectPost({ postId: id, companyId: parsed.data.company_id, comment });
  if (!result.ok) return respond(result);

  if (result.data.createdBy) {
    void dispatch({
      event: "approval_decided",
      companyId: parsed.data.company_id,
      postMasterId: id,
      submitterUserId: result.data.createdBy,
      decision: "rejected",
      comment: result.data.comment ?? undefined,
    });
  }

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
