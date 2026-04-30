import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { buildAuthRedirectUrl } from "@/lib/auth-redirect";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderInviteEmail } from "@/lib/email/templates/invite";
import { createInvite } from "@/lib/invites";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";

// AUTH-FOUNDATION P3.2 — POST /api/admin/invites.
//
// Per-actor role gating per the brief's role matrix:
//   - super_admin: can invite admin OR user
//   - admin:       can invite user only (not admin)
//   - user:        403 (gate denies)
//
// Body: { email, role: 'admin' | 'user' }
// Returns: { ok: true, data: { invite_id, email, role, expires_at, accept_url } }
//        | { ok: false, error: { code, message } }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    email: z.string().email().max(254),
    role: z.enum(["admin", "user"]),
  })
  .strict();

function errJson(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  // Rate limit: per-actor when authenticated, per-IP otherwise. Reuses
  // the existing 'invite' bucket (20/hour).
  const rlId = gate.user ? `user:${gate.user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("invite", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { email, role: 'admin' | 'user' }.",
          details: { issues: parsed.error.issues },
        },
      },
      { status: 400 },
    );
  }

  // Per-actor role guard — admin can only invite role=user.
  // (super_admin can invite any. The /admin/users UI hides the
  // role dropdown options accordingly; this gate is defence in depth.)
  if (
    gate.user &&
    gate.user.role === "admin" &&
    parsed.data.role !== "user"
  ) {
    return errJson(
      "FORBIDDEN",
      "Admins can only invite role=user. Promote the user later requires a super_admin.",
      403,
    );
  }

  const result = await createInvite({
    email: parsed.data.email,
    role: parsed.data.role,
    invitedBy: gate.user?.id ?? null,
  });

  if (!result.ok) {
    const status =
      result.error.code === "PENDING_EXISTS" ||
      result.error.code === "ACTIVE_USER_EXISTS"
        ? 409
        : result.error.code === "INVALID_ROLE"
          ? 400
          : 500;
    return errJson(result.error.code, result.error.message, status);
  }

  // Build the accept URL. The auth-redirect helper already resolves
  // NEXT_PUBLIC_SITE_URL → request origin → localhost in that order
  // so dev / preview / prod all just work.
  const acceptUrl = buildAuthRedirectUrl(
    `/auth/accept-invite?token=${encodeURIComponent(result.raw_token)}`,
    req,
  );

  // Render + send. Email failure is logged but does NOT roll back the
  // invite — the action_link can be copy-pasted to the invitee out of
  // band if delivery is broken (matches the brief's spec).
  const email = renderInviteEmail({
    invitee_email: parsed.data.email,
    invited_by_email: gate.user?.email ?? "an Opollo admin",
    role: parsed.data.role,
    accept_url: acceptUrl,
    expires_at: result.expires_at,
  });
  const sendResult = await sendEmail({
    to: parsed.data.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (!sendResult.ok) {
    logger.warn("admin.invites.email_send_failed", {
      invite_id: result.invite_id,
      email: parsed.data.email,
      err_code: sendResult.error.code,
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      invite_id: result.invite_id,
      email: parsed.data.email,
      role: parsed.data.role,
      expires_at: result.expires_at,
      // Surface the accept URL so an operator can copy-paste if email
      // delivery failed (mirrors the legacy magic-link route's pattern).
      accept_url: sendResult.ok ? null : acceptUrl,
      email_sent: sendResult.ok,
    },
  });
}
