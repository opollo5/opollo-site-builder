"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { createRouteAuthClient } from "@/lib/auth";
import { buildAuthRedirectUrl } from "@/lib/auth-redirect";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderLoginApprovalEmail } from "@/lib/email/templates/login-approval";
import { logger } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  createLoginChallenge,
  recentChallengeCountForUser,
} from "@/lib/2fa/challenges";
import {
  DEVICE_ID_COOKIE,
  PENDING_2FA_COOKIE,
  decodeDeviceCookie,
  encodePending2faCookie,
  getPending2faCookieMaxAgeSeconds,
} from "@/lib/2fa/cookies";
import {
  isDeviceTrusted,
  touchTrustedDevice,
} from "@/lib/2fa/devices";
import { is2faEnabled } from "@/lib/2fa/flag";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Server Action backing the /login form.
//
// AUTH-FOUNDATION P4.2 — interception layered on top of the existing
// password-validation flow. When AUTH_2FA_ENABLED is on AND the
// browser doesn't present a signed device_id cookie matching a
// non-revoked trusted_devices row for this user:
//   1. Create a login_challenges row (15-min expiry).
//   2. Send an approval email with a per-challenge raw token.
//   3. Set the opollo_2fa_pending cookie (signed challenge_id).
//      Middleware reads this cookie + redirects every admin
//      navigation back to /login/check-email until cleared.
//   4. Redirect to /login/check-email?challenge_id=...
//
// When the flag is off, behaviour is unchanged from M14: validate
// password, redirect to `next`.
//
// When 5 challenges have already been issued for this user in the
// last hour, return an error (per the brief §4 rate limit).
// ---------------------------------------------------------------------------

export type LoginState = { error?: string };

const MAX_CHALLENGES_PER_HOUR = 5;

function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/admin/sites";
  }
  return raw;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const headersList = headers();
  const ip = getClientIp(headersList);
  const userAgent = headersList.get("user-agent");
  const rl = await checkRateLimit("login", `ip:${ip}`);
  if (!rl.ok) {
    return {
      error: `Too many sign-in attempts. Try again in ${rl.retryAfterSec} seconds.`,
    };
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = createRouteAuthClient();
  const { error: signInError, data } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    // Same opaque message for bad email vs bad password — no
    // account-enumeration oracle.
    return { error: "Invalid email or password." };
  }
  const userId = data.user?.id;
  if (!userId) {
    // Should be unreachable when signInError is null, but defensively
    // surface a generic failure rather than redirecting on undefined
    // session state.
    return { error: "Sign-in failed. Please try again." };
  }

  // Flag off → existing behaviour. No 2FA cookies are ever set when the
  // flag is off, so there's nothing stale to clear on this path.
  if (!is2faEnabled()) {
    redirect(next);
  }

  // Flag on — check for a matching trusted device.
  const cookieJar = cookies();

  // Any stale 2FA cookies from a prior aborted attempt must be cleared
  // on every successful path that does NOT issue a new challenge —
  // otherwise middleware sees the leftover opollo_2fa_pending cookie
  // and bounces every admin navigation back to /login/check-email,
  // looking like a "stuck after sign-in" bug. The challenge-issuing
  // path below overwrites these cookies with fresh values, so the
  // clears here only apply on the trusted-device shortcut.
  function clearStale2faCookies() {
    for (const name of [PENDING_2FA_COOKIE, "opollo_pending_device_id"]) {
      cookieJar.set(name, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 0,
      });
    }
  }

  const cookieValue = cookieJar.get(DEVICE_ID_COOKIE)?.value;
  const deviceIdFromCookie = decodeDeviceCookie(cookieValue);
  if (deviceIdFromCookie) {
    const trusted = await isDeviceTrusted({
      userId,
      deviceId: deviceIdFromCookie,
    });
    if (trusted) {
      // Skip the challenge — bump last_used_at + go.
      await touchTrustedDevice({ userId, deviceId: deviceIdFromCookie });
      clearStale2faCookies();
      redirect(next);
    }
  }

  // Untrusted device → issue a challenge.
  const recentCount = await recentChallengeCountForUser(userId);
  if (recentCount >= MAX_CHALLENGES_PER_HOUR) {
    // Clear the just-set session — user shouldn't be logged in
    // without 2FA when they hit the rate limit. Sign-out clears the
    // session cookie via the SSR adapter.
    await supabase.auth.signOut();
    return {
      error:
        "Too many sign-in attempts. Try again in an hour or contact your admin.",
    };
  }

  const challenge = await createLoginChallenge({
    userId,
    ip,
    userAgent,
  });
  if (!challenge.ok) {
    await supabase.auth.signOut();
    return {
      error:
        "Could not create sign-in challenge. Try again or contact your admin.",
    };
  }

  // Build the approve URL through the canonical redirect helper.
  const approveUrl = buildAuthRedirectUrl(
    `/auth/approve?token=${encodeURIComponent(challenge.raw_token)}`,
  );

  const emailBody = renderLoginApprovalEmail({
    to_email: email,
    approve_url: approveUrl,
    expires_at: challenge.expires_at,
    ua_string: userAgent,
  });
  const sendResult = await sendEmail({
    to: email,
    subject: emailBody.subject,
    html: emailBody.html,
    text: emailBody.text,
  });
  if (!sendResult.ok) {
    // Don't strand the user — flag the send failure to the
    // check-email page via a query param so it can offer "Resend
    // email" without the 60s cooldown.
    logger.warn("auth.2fa.email_send_failed", {
      err_code: sendResult.error.code,
      challenge_id: challenge.challenge_id,
    });
  }

  // Mark the session as 2FA-pending. Middleware will redirect every
  // admin navigation back to /login/check-email until this cookie is
  // cleared by complete-login.
  cookieJar.set(PENDING_2FA_COOKIE, encodePending2faCookie(challenge.challenge_id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: getPending2faCookieMaxAgeSeconds(),
  });

  // Stash the device_id we issued in the cookie too — complete-login
  // reads it back to write the trusted_devices row when the operator
  // ticks the trust checkbox. Stored as the same signed-cookie shape
  // for symmetry; cleared either way on complete-login.
  cookieJar.set(
    "opollo_pending_device_id",
    encodePending2faCookie(challenge.device_id),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: getPending2faCookieMaxAgeSeconds(),
    },
  );

  // Pass the success/failure of email along so the page can show a
  // "Email failed — resend without cooldown" hint.
  const checkEmailUrl = `/login/check-email?challenge_id=${encodeURIComponent(
    challenge.challenge_id,
  )}&next=${encodeURIComponent(next)}${sendResult.ok ? "" : "&email_send_failed=1"}`;
  redirect(checkEmailUrl);
}

// helper for tests + the admin gate to reach the same env-aware
// service role client used for ip_hash debugging. Not currently
// imported anywhere else but re-exporting keeps a future need cheap.
export async function getInternalServiceClient() {
  return getServiceRoleClient();
}
