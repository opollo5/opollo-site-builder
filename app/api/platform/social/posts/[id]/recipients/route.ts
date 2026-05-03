import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readJsonBody } from "@/lib/http";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderSocialApprovalRequestEmail } from "@/lib/email/templates/social-approval-request";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  addRecipient,
  listRecipients,
} from "@/lib/platform/social/approvals";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-6 — GET / POST recipients for a post's open approval_request.
//
// We resolve the active approval_request from the post id rather than
// asking the caller to know the request id directly. V1 only allows
// one open request per post (the lib + DB don't enforce this — the
// state machine does: a draft submit creates one, a finalised request
// can't accept new recipients). When a post is in
// pending_client_approval there's exactly one open row.
//
// POST gate: canDo("submit_for_approval") — same role threshold as
// submitting (editor+). The reviewer-add affordance lives next to
// the Submit button on the detail page.
// GET gate: canDo("view_calendar") — viewer+ can see the audit list.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
  email: z.string().email().max(254),
  name: z.string().max(200).nullable().optional(),
  requires_otp: z.boolean().optional(),
});

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        retryable: false,
        ...(details ? { details } : {}),
      },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

function statusForCode(code: string): number {
  switch (code) {
    case "VALIDATION_FAILED":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "INVALID_STATE":
      return 409;
    default:
      return 500;
  }
}

// Resolve the open approval_request for a post. "Open" =
// !revoked_at AND no final_*_at. Returns the request id or null.
async function resolveOpenRequestId(
  postId: string,
  companyId: string,
): Promise<{ id: string } | null> {
  const svc = getServiceRoleClient();
  const r = await svc
    .from("social_approval_requests")
    .select("id, revoked_at, final_approved_at, final_rejected_at")
    .eq("post_master_id", postId)
    .eq("company_id", companyId)
    .is("revoked_at", null)
    .is("final_approved_at", null)
    .is("final_rejected_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (r.error) return null;
  if (!r.data) return null;
  return { id: r.data.id as string };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter (uuid) is required.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const reqRow = await resolveOpenRequestId(id, companyId);
  if (!reqRow) {
    return NextResponse.json(
      {
        ok: true,
        data: { recipients: [], approvalRequestId: null },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  const result = await listRecipients({
    approvalRequestId: reqRow.id,
    companyId,
  });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      statusForCode(result.error.code),
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        recipients: result.data.recipients,
        approvalRequestId: reqRow.id,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return errorJson("VALIDATION_FAILED", "id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, email: string, name?: string, requires_otp?: boolean }.",
      400,
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "submit_for_approval",
  );
  if (gate.kind === "deny") return gate.response;

  const reqRow = await resolveOpenRequestId(id, parsed.data.company_id);
  if (!reqRow) {
    return errorJson(
      "INVALID_STATE",
      "Post has no open approval request. Submit the post for approval first.",
      409,
    );
  }

  const result = await addRecipient({
    approvalRequestId: reqRow.id,
    companyId: parsed.data.company_id,
    email: parsed.data.email,
    name: parsed.data.name ?? null,
    requiresOtp: parsed.data.requires_otp,
  });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      statusForCode(result.error.code),
    );
  }

  // Look up the company name for the email. Best-effort; if the read
  // fails we still want the recipient row to exist (operator can
  // resend manually). The route already authorised access to this
  // company so service-role read is fine.
  const svc = getServiceRoleClient();
  let companyName = "your team";
  const companyRead = await svc
    .from("platform_companies")
    .select("name")
    .eq("id", parsed.data.company_id)
    .maybeSingle();
  if (!companyRead.error && companyRead.data?.name) {
    companyName = companyRead.data.name as string;
  }

  // Look up expires_at on the request for the email body.
  let expiresAt = result.data.recipient.created_at;
  const reqRead = await svc
    .from("social_approval_requests")
    .select("expires_at")
    .eq("id", reqRow.id)
    .maybeSingle();
  if (!reqRead.error && reqRead.data?.expires_at) {
    expiresAt = reqRead.data.expires_at as string;
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;
  const reviewUrl = `${origin}/approve/${result.data.rawToken}`;

  const emailContent = renderSocialApprovalRequestEmail({
    recipient_email: parsed.data.email,
    recipient_name: parsed.data.name?.trim() || null,
    company_name: companyName,
    review_url: reviewUrl,
    expires_at: expiresAt,
  });

  const sendResult = await sendEmail({
    to: parsed.data.email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  if (!sendResult.ok) {
    logger.warn("social.approvals.recipients.add.email_failed", {
      recipient_id: result.data.recipient.id,
      err: sendResult.error?.message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "EMAIL_DELIVERY_FAILED",
          message:
            "Recipient was added but email delivery failed. Revoke and re-add, or resend manually.",
          retryable: false,
          details: { recipient_id: result.data.recipient.id },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { recipient: result.data.recipient },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
