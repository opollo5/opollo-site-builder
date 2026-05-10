import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, conflict, readJsonBody, respond, routeError, validationError } from "@/lib/http";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderSocialApprovalRequestEmail } from "@/lib/email/templates/social-approval-request";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { addRecipient, listRecipients } from "@/lib/platform/social/approvals";
import { getServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: dbUuid(),
  email: z.string().email().max(254),
  name: z.string().max(200).nullable().optional(),
  requires_otp: z.boolean().optional(),
});

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
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const reqRow = await resolveOpenRequestId(id, companyId);
  if (!reqRow) {
    return NextResponse.json(
      { ok: true, data: { recipients: [], approvalRequestId: null }, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }

  const result = await listRecipients({ approvalRequestId: reqRow.id, companyId });
  if (!result.ok) return respond(result);

  return NextResponse.json(
    {
      ok: true,
      data: { recipients: result.data.recipients, approvalRequestId: reqRow.id },
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
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, email: string, name?: string, requires_otp?: boolean }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "submit_for_approval");
  if (gate.kind === "deny") return gate.response;

  const reqRow = await resolveOpenRequestId(id, parsed.data.company_id);
  if (!reqRow) {
    return conflict(
      "INVALID_STATE",
      "Post has no open approval request. Submit the post for approval first.",
    );
  }

  const result = await addRecipient({
    approvalRequestId: reqRow.id,
    companyId: parsed.data.company_id,
    email: parsed.data.email,
    name: parsed.data.name ?? null,
    requiresOtp: parsed.data.requires_otp,
  });
  if (!result.ok) return respond(result);

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
    return routeError(
      "EMAIL_DELIVERY_FAILED",
      "Recipient was added but email delivery failed. Revoke and re-add, or resend manually.",
      { recipient_id: result.data.recipient.id },
    );
  }

  return NextResponse.json(
    { ok: true, data: { recipient: result.data.recipient }, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}
