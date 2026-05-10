import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { sendEmail } from "@/lib/email/sendgrid";
import { renderPlatformInviteEmail } from "@/lib/email/templates/platform-invite";
import {
  dbUuid,
  conflict,
  internalError,
  notFound,
  readJsonBody,
  routeError,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  enqueueInvitationCallbacks,
  sendInvitation,
} from "@/lib/platform/invitations";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/invitations — P2-2.
//
// Creates a platform_invitations row and emails the invitee a magic link
// to set their password and accept. Caller must have manage_invitations
// permission in `company_id` (admin role or Opollo staff).
//
// On insert success, the SendGrid call is best-effort: if email delivery
// fails (4xx from SendGrid, network blip past the retry), the invitation
// row already exists with status='pending'. The response surfaces the
// email failure so the operator knows to either resend or revoke. The
// raw token is NEVER returned in the response — it's only ever in the
// email body. Future P2-3 reminder system retries delivery at day 3.
//
// Errors:
//   400 VALIDATION_FAILED          — bad body shape, malformed email/uuid.
//   401 UNAUTHORIZED               — no session.
//   403 FORBIDDEN                  — caller lacks manage_invitations in
//                                    company_id.
//   404 COMPANY_NOT_FOUND          — company_id resolves to no row.
//   409 ACTIVE_MEMBERSHIP_EXISTS   — email is already a member of some
//                                    company on the platform (V1: one
//                                    user, one company).
//   409 PENDING_INVITE_EXISTS      — pending invitation already exists for
//                                    this (company_id, email).
//   500 INTERNAL_ERROR             — DB / Supabase failure.
//   502 EMAIL_DELIVERY_FAILED      — invitation row created but SendGrid
//                                    rejected the message; operator
//                                    should resend.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SendInviteSchema = z.object({
  company_id: dbUuid(),
  email: z.string().email().max(254),
  role: z.enum(["admin", "approver", "editor", "viewer"]),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = SendInviteSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, email: string, role: 'admin'|'approver'|'editor'|'viewer' }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "manage_invitations",
  );
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("invite", `user:${gate.userId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  // Look up the company record for the email body. Service-role bypasses
  // RLS — the gate above already authorised access to this companyId.
  const svc = getServiceRoleClient();
  const companyResult = await svc
    .from("platform_companies")
    .select("id, name")
    .eq("id", parsed.data.company_id)
    .maybeSingle();
  if (companyResult.error) {
    logger.error("platform.invitations.send.company_lookup_failed", {
      err: companyResult.error.message,
    });
    return internalError("Failed to read company.");
  }
  if (!companyResult.data) {
    return notFound("No company with that id.");
  }

  // Resolve inviter email for the email body. Best-effort — if missing,
  // template falls back to "An admin".
  let inviterEmail: string | null = null;
  const inviterResult = await svc
    .from("platform_users")
    .select("email")
    .eq("id", gate.userId)
    .maybeSingle();
  if (inviterResult.data?.email) inviterEmail = inviterResult.data.email;

  const result = await sendInvitation({
    companyId: parsed.data.company_id,
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: gate.userId,
  });

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "VALIDATION_FAILED") return validationError(message);
    if (code === "ACTIVE_MEMBERSHIP_EXISTS" || code === "PENDING_INVITE_EXISTS") {
      return conflict(code, message);
    }
    return internalError(message);
  }

  // Build accept URL. Configurable per environment via NEXT_PUBLIC_SITE_URL;
  // falls back to the request origin (covers localhost + preview deploys).
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;
  const acceptUrl = `${origin}/invite/${result.rawToken}`;

  const email = renderPlatformInviteEmail({
    invitee_email: parsed.data.email,
    invited_by_email: inviterEmail,
    company_name: companyResult.data.name,
    role: parsed.data.role,
    accept_url: acceptUrl,
    expires_at: result.invitation.expires_at,
  });

  const sendResult = await sendEmail({
    to: parsed.data.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (!sendResult.ok) {
    logger.warn("platform.invitations.send.email_failed", {
      invitation_id: result.invitation.id,
      err: sendResult.error?.message,
    });
    return routeError("EMAIL_DELIVERY_FAILED", "Invitation was created but email delivery failed. Revoke and resend, or wait for the day-3 reminder.", { invitation_id: result.invitation.id });
  }

  // Schedule the day-3 reminder + day-14 expiry callbacks via QStash.
  // No-op when QSTASH_TOKEN is unset (local dev / unprovisioned envs).
  // Failures are logged but never fail the parent request — the
  // invitation row + initial email already succeeded.
  await enqueueInvitationCallbacks({
    invitationId: result.invitation.id,
    rawToken: result.rawToken,
    expiresAt: result.invitation.expires_at,
    origin,
  });

  // Strip token-related fields from the response — token_hash isn't
  // included in the select but stay defensive on the shape.
  return NextResponse.json(
    {
      ok: true,
      data: { invitation: result.invitation },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
