import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  consumeChallenge,
  lookupChallengeById,
} from "@/lib/2fa/challenges";
import { buildAuthRedirectUrl } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// AUTH-FOUNDATION P4.3 — POST /api/auth/approve-here.
//
// Lost-tab fallback. Operator clicked "Complete sign-in here" on the
// /auth/approve page (likely on a different device than the one they
// signed in from). The challenge was approved when the page loaded;
// here we:
//
//   1. Consume the challenge (CAS approved → consumed).
//   2. Generate a Supabase magic link for the user via the admin API.
//   3. Return the action_link as redirect_to. The browser follows
//      it; the magic-link callback sets the session cookie + drops
//      the operator on /admin/sites.
//
// trust_device is intentionally FALSE in this path — the device
// completing the flow may be a phone, and we shouldn't auto-trust
// a non-original device.
//
// Public route: the challenge id is the auth (random uuid; we
// re-look-up to confirm it's in the right state).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    challenge_id: z.string().uuid(),
  })
  .strict();

export async function POST(_req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await _req.json();
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
          message: "Body must be { challenge_id }.",
        },
      },
      { status: 400 },
    );
  }

  const challenge = await lookupChallengeById(parsed.data.challenge_id);
  if (!challenge) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Challenge not found." } },
      { status: 404 },
    );
  }
  if (challenge.status !== "approved") {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_APPROVED",
          message:
            challenge.status === "consumed"
              ? "This sign-in was already completed elsewhere."
              : "Approve the link first.",
        },
      },
      { status: 409 },
    );
  }

  const consumed = await consumeChallenge(parsed.data.challenge_id);
  if (!consumed.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: consumed.reason.toUpperCase(),
          message: "Could not consume the approval. It may have been used in another tab.",
        },
      },
      { status: 409 },
    );
  }

  // Resolve the user's email + generate a magic link.
  const svc = getServiceRoleClient();
  const userRow = await svc
    .from("opollo_users")
    .select("email")
    .eq("id", challenge.user_id)
    .maybeSingle();
  const email = userRow.data?.email as string | undefined;
  if (!email) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Could not resolve user email.",
        },
      },
      { status: 500 },
    );
  }

  const redirectTo = buildAuthRedirectUrl(`/api/auth/callback?next=/admin/sites`);
  const linkRes = await svc.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (linkRes.error || !linkRes.data?.properties?.action_link) {
    logger.error("auth.2fa.approve-here.magiclink_failed", {
      err: linkRes.error?.message,
      challenge_id: parsed.data.challenge_id,
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "MAGIC_LINK_FAILED",
          message: "Could not issue session token. Sign in again from your original device.",
        },
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    data: { redirect_to: linkRes.data.properties.action_link },
  });
}
