import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  consumeChallenge,
  lookupChallengeById,
} from "@/lib/2fa/challenges";
import {
  DEVICE_ID_COOKIE,
  PENDING_2FA_COOKIE,
  decodePending2faCookie,
  encodeDeviceCookie,
  getCookieMaxAgeSeconds,
} from "@/lib/2fa/cookies";
import { registerTrustedDevice } from "@/lib/2fa/devices";
import { createRouteAuthClient } from "@/lib/auth";
import { readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/rate-limit";

// AUTH-FOUNDATION P4.2 — POST /api/auth/complete-login.
//
// Called by the /login/check-email polling shell once the challenge
// flips to status='approved'. Body: { challenge_id, trust_device }.
//
// On success:
//   - consume the challenge (CAS approved → consumed)
//   - if trust_device=true: write/upsert a trusted_devices row +
//     set the signed device_id cookie for 30 days
//   - clear the opollo_2fa_pending cookie + the
//     opollo_pending_device_id cookie
//   - return { ok: true, data: { redirect_to } } (the next destination
//     was preserved on the cookie set by the login server action)
//
// Idempotency / concurrency: two tabs racing the complete-login (e.g.
// operator approves on phone while desktop is open) — the
// consumeChallenge CAS guarantees only one wins. Previously the loser
// got 409 ALREADY_CONSUMED and the polling page rendered a static
// "continue to admin" link whose click was bounced by middleware
// (because THIS browser's opollo_2fa_pending cookie had not been
// cleared on the loser's tab). That looked like a "stuck after sign-
// in" bug. Now the loser is treated as success-after-the-fact:
// provided the challenge belongs to the same authenticated user, we
// clear THIS browser's 2FA cookies and return ok with the redirect
// target. The trust-device write is skipped on the loser path because
// the winning tab already wrote it (or chose not to).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    challenge_id: z.string().uuid(),
    trust_device: z.boolean(),
  })
  .strict();

function clearPendingCookies(cookieJar: ReturnType<typeof cookies>): void {
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const userRes = await supabase.auth.getUser();
  if (userRes.error || !userRes.data.user) {
    logger.warn("auth.2fa.complete_login.no_session", {
      err: userRes.error?.message,
    });
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No session." } },
      { status: 401 },
    );
  }
  const userId = userRes.data.user.id;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    logger.warn("auth.2fa.complete_login.validation_failed", {
      user_id: userId,
      issues: parsed.error.issues,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { challenge_id, trust_device }.",
          details: { issues: parsed.error.issues },
        },
      },
      { status: 400 },
    );
  }

  // Re-check the challenge belongs to this user.
  const challenge = await lookupChallengeById(parsed.data.challenge_id);
  if (!challenge) {
    logger.warn("auth.2fa.complete_login.challenge_not_found", {
      user_id: userId,
      challenge_id: parsed.data.challenge_id,
    });
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Challenge not found." } },
      { status: 404 },
    );
  }
  if (challenge.user_id !== userId) {
    logger.warn("auth.2fa.complete_login.user_mismatch", {
      user_id: userId,
      challenge_id: parsed.data.challenge_id,
      challenge_user_id: challenge.user_id,
    });
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Not your challenge." } },
      { status: 403 },
    );
  }

  const cookieJar = cookies();
  const headersList = headers();

  // Already-consumed branch: another tab/device finished the flow
  // already. THIS browser still has the opollo_2fa_pending cookie set,
  // and middleware will keep bouncing /admin navigation back to
  // /login/check-email until we clear it. Clearing the cookie + 200ing
  // is the right move — the user is the same, the challenge already
  // approved an authenticated session, we're just tidying the cookies
  // on this specific tab. Trust-device write is skipped (the winning
  // tab made that decision).
  if (challenge.status === "consumed") {
    logger.info("auth.2fa.complete_login.already_consumed", {
      user_id: userId,
      challenge_id: parsed.data.challenge_id,
    });
    clearPendingCookies(cookieJar);
    return NextResponse.json({
      ok: true,
      data: { redirect_to: "/admin/sites", already_consumed: true },
    });
  }

  const consumed = await consumeChallenge(parsed.data.challenge_id);
  if (!consumed.ok) {
    // expired / not_approved / a CAS race that flipped to consumed
    // between the lookup above and this call.
    if (consumed.reason === "already_consumed") {
      logger.info("auth.2fa.complete_login.race_already_consumed", {
        user_id: userId,
        challenge_id: parsed.data.challenge_id,
      });
      clearPendingCookies(cookieJar);
      return NextResponse.json({
        ok: true,
        data: { redirect_to: "/admin/sites", already_consumed: true },
      });
    }
    const status = consumed.reason === "expired" ? 410 : 409;
    logger.warn("auth.2fa.complete_login.consume_failed", {
      user_id: userId,
      challenge_id: parsed.data.challenge_id,
      reason: consumed.reason,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: consumed.reason.toUpperCase(),
          message:
            consumed.reason === "expired"
              ? "Challenge expired before completion."
              : "Challenge has not been approved yet.",
        },
      },
      { status },
    );
  }

  // Trust-device path: upsert a trusted_devices row + set the signed
  // device_id cookie. The device_id was captured into a separate
  // pending cookie at challenge-issue time; read it back here.
  let trustDeviceOutcome:
    | "skipped_no_request"
    | "skipped_no_device_id"
    | "registered"
    | "register_failed" = "skipped_no_request";
  if (parsed.data.trust_device) {
    const pendingDeviceCookie = cookieJar.get("opollo_pending_device_id")?.value;
    const deviceId =
      decodePending2faCookie(pendingDeviceCookie) ?? challenge.device_id;
    if (!deviceId || deviceId.length === 0) {
      // Edge case: neither the pending cookie (cleared / never set) nor
      // the challenge row carries a device_id. Without one we can't write
      // a trusted_devices row keyed to anything — log loudly so it's
      // greppable when an operator hits the empty /account/devices list
      // we saw during UAT (2026-05-02).
      trustDeviceOutcome = "skipped_no_device_id";
      logger.warn("auth.2fa.trust_device.skipped_no_device_id", {
        user_id: userId,
        challenge_id: parsed.data.challenge_id,
        had_pending_cookie: Boolean(pendingDeviceCookie),
        challenge_device_id_present: Boolean(challenge.device_id),
      });
    } else {
      const ok = await registerTrustedDevice({
        userId,
        deviceId,
        ip: getClientIp(headersList),
        userAgent: headersList.get("user-agent"),
      });
      trustDeviceOutcome = ok ? "registered" : "register_failed";
      cookieJar.set(DEVICE_ID_COOKIE, encodeDeviceCookie(deviceId), {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: getCookieMaxAgeSeconds(),
      });
    }
  }

  clearPendingCookies(cookieJar);

  logger.info("auth.2fa.complete_login.success", {
    user_id: userId,
    challenge_id: parsed.data.challenge_id,
    trust_device: parsed.data.trust_device,
    trust_device_outcome: trustDeviceOutcome,
  });

  return NextResponse.json({
    ok: true,
    data: {
      redirect_to: "/admin/sites",
      trust_device_outcome: trustDeviceOutcome,
    },
  });
}
