import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, internalError, invalidState, readJsonBody, respond, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { dispatch } from "@/lib/platform/notifications";
import { submitForApproval } from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const Schema = z.object({ company_id: dbUuid() });

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

  const gate = await requireCanDoForApi(parsed.data.company_id, "submit_for_approval");
  if (gate.kind === "deny") return gate.response;

  // V2 dispatch: if the post is in social_post_drafts, transition draft → pending_approval.
  const svc = getServiceRoleClient();
  const { data: v2draft } = await svc
    .from("social_post_drafts")
    .select("id, state")
    .eq("id", id)
    .eq("company_id", parsed.data.company_id)
    .maybeSingle();

  if (v2draft) {
    if ((v2draft.state as string) !== "draft") {
      return invalidState(`Draft is in state '${v2draft.state as string}', expected 'draft'.`);
    }
    const { error } = await svc
      .from("social_post_drafts")
      .update({ state: "pending_approval", updated_by: gate.userId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", parsed.data.company_id)
      .eq("state", "draft");
    if (error) return internalError(`Failed to submit draft: ${error.message}`);
    return NextResponse.json(
      { ok: true, data: { id, state: "pending_approval" }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  // V1 fallback.
  const result = await submitForApproval({ postId: id, companyId: parsed.data.company_id });
  if (!result.ok) return respond(result);

  void dispatch({
    event: "approval_requested",
    companyId: parsed.data.company_id,
    postMasterId: id,
    submitterUserId: gate.userId,
  });

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
