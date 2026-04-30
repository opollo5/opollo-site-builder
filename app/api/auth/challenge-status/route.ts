import { NextResponse, type NextRequest } from "next/server";

import { lookupChallengeById } from "@/lib/2fa/challenges";
import { createRouteAuthClient } from "@/lib/auth";

// AUTH-FOUNDATION P4.2 — GET /api/auth/challenge-status?challenge_id=...
//
// Polled every 3s by /login/check-email. Returns the challenge's
// status (pending / approved / expired / consumed). The signed-in
// user must own the challenge — we re-check user_id against the
// session every poll so a leaked challenge_id can't be polled by a
// different user (defence in depth; the random uuid is hard to
// guess in any case).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const challengeId = req.nextUrl.searchParams.get("challenge_id") ?? "";
  if (!UUID_RE.test(challengeId)) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid challenge_id." } },
      { status: 400 },
    );
  }

  const supabase = createRouteAuthClient();
  const userRes = await supabase.auth.getUser();
  if (userRes.error || !userRes.data.user) {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "No session." } },
      { status: 401 },
    );
  }

  const challenge = await lookupChallengeById(challengeId);
  if (!challenge) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Challenge not found." } },
      { status: 404 },
    );
  }
  if (challenge.user_id !== userRes.data.user.id) {
    return NextResponse.json(
      { ok: false, error: { code: "FORBIDDEN", message: "Not your challenge." } },
      { status: 403 },
    );
  }

  // Auto-flip expired status if the row is past expiry but still
  // shows pending — the polling client expects a terminal signal.
  let status = challenge.status;
  if (status === "pending" && new Date(challenge.expires_at).getTime() <= Date.now()) {
    status = "expired";
  }

  return NextResponse.json({
    ok: true,
    data: { status, expires_at: challenge.expires_at },
  });
}
