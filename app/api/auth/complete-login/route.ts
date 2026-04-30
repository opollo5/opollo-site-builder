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
// Concurrency: two tabs racing the complete-login (e.g. operator
// approves on phone while desktop is open) — the consumeChallenge
// CAS guarantees only one wins. The loser sees ALREADY_CONSUMED and
// the polling page falls into the "consumed" branch (refresh →
// admin).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    challenge_id: z.string().uuid(),
    trust_device: z.boolean(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createRouteAuthClient();
  const userRes = await supabase.auth.getUser();
  if (userRes.error || !userRes.data.user) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No session." } },
      { status: 401 },
    );
  }
  const userId = userRes.data.user.id;

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
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Challenge not found." } },
      { status: 404 },
    );
  }
  if (challenge.user_id !== userId) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Not your challenge." } },
      { status: 403 },
    );
  }

  const consumed = await consumeChallenge(parsed.data.challenge_id);
  if (!consumed.ok) {
    const status = consumed.reason === "expired" ? 410 : 409;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: consumed.reason.toUpperCase(),
          message:
            consumed.reason === "expired"
              ? "Challenge expired before completion."
              : consumed.reason === "not_approved"
                ? "Challenge has not been approved yet."
                : "Challenge was already consumed.",
        },
      },
      { status },
    );
  }

  const cookieJar = cookies();
  const headersList = headers();

  // Trust-device path: upsert a trusted_devices row + set the signed
  // device_id cookie. The device_id was captured into a separate
  // pending cookie at challenge-issue time; read it back here.
  if (parsed.data.trust_device) {
    const pendingDeviceCookie = cookieJar.get("opollo_pending_device_id")?.value;
    const deviceId =
      decodePending2faCookie(pendingDeviceCookie) ?? challenge.device_id;
    await registerTrustedDevice({
      userId,
      deviceId,
      ip: getClientIp(headersList),
      userAgent: headersList.get("user-agent"),
    });
    cookieJar.set(DEVICE_ID_COOKIE, encodeDeviceCookie(deviceId), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: getCookieMaxAgeSeconds(),
    });
  }

  // Clear the pending cookies regardless of trust-device choice.
  cookieJar.set(PENDING_2FA_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  cookieJar.set("opollo_pending_device_id", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return NextResponse.json({
    ok: true,
    data: { redirect_to: "/admin/sites" },
  });
}
