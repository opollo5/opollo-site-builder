import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  createLoginChallenge,
  lookupChallengeById,
  recentChallengeCountForUser,
} from "@/lib/2fa/challenges";
import {
  PENDING_2FA_COOKIE,
  decodePending2faCookie,
  encodePending2faCookie,
  getPending2faCookieMaxAgeSeconds,
} from "@/lib/2fa/cookies";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderLoginApprovalEmail } from "@/lib/email/templates/login-approval";
import { createRouteAuthClient } from "@/lib/auth";
import { buildAuthRedirectUrl } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// AUTH-FOUNDATION P4.2 — POST /api/auth/resend-challenge.
//
// Called by /login/check-email when the operator clicks "Resend
// email". Issues a fresh login_challenges row + email + cookies.
// The previous pending challenge stays in 'pending' until expiry —
// either the new approval link or the old one will work, with
// whichever lands first winning.
//
// Rate-limited at 5 challenges/email/hour (per the §4 brief). We
// re-check that cap here so a UI bypass can't burn the email's quota.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CHALLENGES_PER_HOUR = 5;

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const userRes = await supabase.auth.getUser();
  if (userRes.error || !userRes.data.user) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No session." } },
      { status: 401 },
    );
  }
  const userId = userRes.data.user.id;

  const cookieJar = cookies();
  const cookieValue = cookieJar.get(PENDING_2FA_COOKIE)?.value;
  const cookieChallengeId = decodePending2faCookie(cookieValue);
  if (!cookieChallengeId) {
    return NextResponse.json(
      { ok: false, error: { code: "NO_PENDING_CHALLENGE", message: "No pending challenge." } },
      { status: 409 },
    );
  }

  // Sanity-check the existing challenge belongs to this user (defence
  // in depth before issuing a new one).
  const existing = await lookupChallengeById(cookieChallengeId);
  if (!existing || existing.user_id !== userId) {
    return NextResponse.json(
      { ok: false, error: { code: "CHALLENGE_MISMATCH", message: "Pending challenge does not match the current session." } },
      { status: 409 },
    );
  }

  // Rate limit.
  const recentCount = await recentChallengeCountForUser(userId);
  if (recentCount >= MAX_CHALLENGES_PER_HOUR) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message:
            "Too many sign-in attempts. Try again in an hour or contact your admin.",
        },
      },
      { status: 429 },
    );
  }

  const headersList = headers();
  const fresh = await createLoginChallenge({
    userId,
    ip: getClientIp(headersList),
    userAgent: headersList.get("user-agent"),
  });
  if (!fresh.ok) {
    logger.error("auth.2fa.resend.create_failed", { err: fresh.error.message });
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: fresh.error.message } },
      { status: 500 },
    );
  }

  // Pull the user's email for the To header.
  const svc = getServiceRoleClient();
  const userRow = await svc
    .from("opollo_users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  const toEmail =
    (userRow.data?.email as string | undefined) ??
    userRes.data.user.email ??
    null;
  if (!toEmail) {
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Could not resolve user email." } },
      { status: 500 },
    );
  }

  const approveUrl = buildAuthRedirectUrl(
    `/auth/approve?token=${encodeURIComponent(fresh.raw_token)}`,
  );
  const emailBody = renderLoginApprovalEmail({
    to_email: toEmail,
    approve_url: approveUrl,
    expires_at: fresh.expires_at,
    ua_string: headersList.get("user-agent"),
  });
  const sendResult = await sendEmail({
    to: toEmail,
    subject: emailBody.subject,
    html: emailBody.html,
    text: emailBody.text,
  });
  if (!sendResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "EMAIL_SEND_FAILED",
          message: `Resend failed: ${sendResult.error.message}. Try again or contact your admin.`,
        },
      },
      { status: 502 },
    );
  }

  // Replace the pending cookies with the new challenge's identifiers.
  cookieJar.set(PENDING_2FA_COOKIE, encodePending2faCookie(fresh.challenge_id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: getPending2faCookieMaxAgeSeconds(),
  });
  cookieJar.set(
    "opollo_pending_device_id",
    encodePending2faCookie(fresh.device_id),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: getPending2faCookieMaxAgeSeconds(),
    },
  );

  return NextResponse.json({ ok: true });
}
