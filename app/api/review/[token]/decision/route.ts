import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

import { internalError, notFound, readJsonBody, parseBodyWith, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";
import { ApproveSchema } from "@/lib/social/schemas/approve";
import { notifyRejection } from "@/lib/social/approval/notify-approver";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/review/[token]/decision  (D5 — public magic-link approval path)
//
// External approvers have no Supabase session. The JWT review token that was
// embedded in the /review/[token] URL IS the auth credential (D5).
//
// Token claims: { sub: draftId, purpose: "review", exp: now+14d }
// Signed with NEXTAUTH_SECRET / AUTH_SECRET (same as /api/platform/social/
// drafts/[id]/review-link).
//
// State machine: pending_approval → scheduled (approved) or rejected.
// Decision row: approver_user_id is NULL for external approvers (email from
// the review link is not captured here — the recipient email is the identity
// per D5, but we don't re-validate it on submit to keep the UX frictionless).
//
// One-time use: once the draft leaves pending_approval, the route returns 409.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReviewClaims {
  sub?: string;
  purpose?: string;
  exp?: number;
}

async function verifyToken(
  token: string,
): Promise<{ ok: true; draftId: string } | { ok: false; status: number; message: string }> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    logger.error("review.decision.missing_secret");
    return { ok: false, status: 500, message: "Server configuration error." };
  }
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const claims = payload as ReviewClaims;
    if (claims.purpose !== "review" || !claims.sub) {
      return { ok: false, status: 400, message: "This review link is invalid." };
    }
    return { ok: true, draftId: claims.sub };
  } catch {
    return { ok: false, status: 400, message: "This review link is invalid or has expired." };
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  const rl = await checkRateLimit("approval_decision", `ip:${getClientIp(req)}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const verify = await verifyToken(token);
  if (!verify.ok) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_TOKEN", message: verify.message }, timestamp: new Date().toISOString() },
      { status: verify.status },
    );
  }
  const { draftId } = verify;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(ApproveSchema, body);
  if (!parsed.ok) return parsed.response;
  const { decision, rejection_reason } = parsed.data;

  const svc = getServiceRoleClient();

  const { data: draft, error: draftErr } = await svc
    .from("social_post_drafts")
    .select("id, company_id, state, created_by, content")
    .eq("id", draftId)
    .maybeSingle();

  if (draftErr) {
    logger.error("review.decision.draft_lookup_failed", { draftId, err: draftErr.message });
    return internalError("Draft lookup failed.");
  }
  if (!draft) return notFound("Draft not found or link is invalid.");

  if ((draft.state as string) !== "pending_approval") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ALREADY_DECIDED",
          message: `This post has already been ${draft.state as string}.`,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 409 },
    );
  }

  const newState = decision === "approved" ? "scheduled" : "rejected";

  const { error: updateErr } = await svc
    .from("social_post_drafts")
    .update({ state: newState, updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("state", "pending_approval"); // optimistic concurrency guard

  if (updateErr) {
    logger.error("review.decision.update_failed", { draftId, err: updateErr.message });
    return internalError("Failed to record decision.");
  }

  // Best-effort decision row — external approver has no platform user_id.
  const { error: decisionErr } = await svc
    .from("social_post_approval_decisions")
    .insert({
      draft_id: draftId,
      approver_user_id: null,
      decision,
      rejection_reason: rejection_reason ?? null,
    });

  if (decisionErr) {
    logger.warn("review.decision.decision_insert_failed", { draftId, err: decisionErr.message });
  }

  if (decision === "rejected") {
    const { data: author } = await svc
      .from("platform_users")
      .select("email")
      .eq("id", draft.created_by as string)
      .maybeSingle();
    if (author?.email) {
      void notifyRejection({
        draftId,
        authorEmail: author.email as string,
        rejectionReason: rejection_reason!,
        approverName: "External reviewer",
      });
    }
  }

  return NextResponse.json(
    { ok: true, data: { state: newState }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
