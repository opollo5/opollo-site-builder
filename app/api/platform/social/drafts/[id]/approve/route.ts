import { NextResponse, type NextRequest } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { ApproveSchema } from "@/lib/social/schemas/approve";
import { notifyRejection } from "@/lib/social/approval/notify-approver";
import { internalError, notFound, validationError, parseBodyWith, validateUuidParam, readJsonBody } from "@/lib/http";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/platform/social/drafts/[id]/approve
//
// Approver approves or rejects a draft in pending_approval state.
// auth.uid() must equal draft.approver_user_id OR be a company admin.
// On approve: state → scheduled.
// On reject: state → rejected, author notified.
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(ApproveSchema, body);
  if (!parsed.ok) return parsed.response;
  const { decision, rejection_reason } = parsed.data;

  const svc = getServiceRoleClient();
  const { data: draft } = await svc
    .from("social_post_drafts")
    .select("id, company_id, state, approver_user_id, created_by, content")
    .eq("id", idCheck.value)
    .maybeSingle();

  if (!draft) return notFound(`Draft ${id} not found.`);
  if ((draft.state as string) !== "pending_approval") {
    return validationError(`Draft is in state '${draft.state as string}', not pending_approval.`);
  }

  const gate = await requireCanDoForApi(draft.company_id as string, "edit_post");
  if (gate.kind === "deny") return gate.response;

  // Must be the named approver or a company admin.
  if (draft.approver_user_id !== gate.userId) {
    const { data: membership } = await svc
      .from("platform_company_users")
      .select("role")
      .eq("company_id", draft.company_id as string)
      .eq("user_id", gate.userId)
      .maybeSingle();
    if ((membership?.role as string | null) !== "admin") {
      return NextResponse.json(
        { ok: false, error: { code: "FORBIDDEN", message: "You are not the designated approver for this draft." }, timestamp: new Date().toISOString() },
        { status: 403 },
      );
    }
  }

  const rl = await checkRateLimit("approval_decision", `ip:${req.headers.get("x-forwarded-for") ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const newState = decision === "approved" ? "scheduled" : "rejected";

  const { error: updateErr } = await svc
    .from("social_post_drafts")
    .update({ state: newState, updated_at: new Date().toISOString() })
    .eq("id", idCheck.value);

  if (updateErr) {
    logger.error("approve.update_failed", { draftId: id, err: updateErr.message });
    return internalError("Failed to update draft state.");
  }

  const { data: decisionRow, error: decisionErr } = await svc
    .from("social_post_approval_decisions")
    .insert({
      draft_id: idCheck.value,
      approver_user_id: gate.userId,
      decision,
      rejection_reason: rejection_reason ?? null,
    })
    .select("id")
    .single();

  if (decisionErr) {
    logger.warn("approve.decision_insert_failed", { draftId: id, err: decisionErr.message });
  }

  if (decision === "rejected") {
    // Notify author — best effort.
    const { data: author } = await svc
      .from("platform_users")
      .select("email")
      .eq("id", draft.created_by as string)
      .maybeSingle();
    if (author?.email) {
      void notifyRejection({
        draftId: id,
        authorEmail: author.email as string,
        rejectionReason: rejection_reason!,
        approverName: gate.userId,
      });
    }
  }

  const { data: updatedDraft } = await svc
    .from("social_post_drafts")
    .select("*")
    .eq("id", idCheck.value)
    .single();

  return NextResponse.json({
    ok: true,
    data: { draft: updatedDraft, decision_id: decisionRow?.id ?? null },
    timestamp: new Date().toISOString(),
  });
}
