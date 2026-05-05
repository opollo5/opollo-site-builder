import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { acceptInvite } from "@/lib/invites";
import { readJsonBody, validationError } from "@/lib/http";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";

// AUTH-FOUNDATION P3.2 — POST /api/auth/accept-invite.
//
// Public route — the token IS the auth. Validates the token,
// creates auth.users via Supabase admin API, marks the invite
// accepted + writes audit row atomically. Returns enough info for
// the page to redirect to /login (no auto-sign-in: brief is explicit
// that the new user lands on /login after acceptance).
//
// Rate limit: per-IP via the existing 'login' bucket (10/min).
// The token is high-entropy + 24h-expiring; brute force is
// impractical, but the rate limit caps enumeration noise.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    token: z.string().min(32).max(128),
    password: z.string().min(12).max(200),
  })
  .strict();

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit("login", `ip:${getClientIp(req)}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message:
            "Body must be { token: string (≥32 chars), password: string (≥12 chars) }.",
          details: { issues: parsed.error.issues },
        },
      },
      { status: 400 },
    );
  }

  const result = await acceptInvite({
    rawToken: parsed.data.token,
    password: parsed.data.password,
  });

  if (!result.ok) {
    const status =
      result.error.code === "INVALID_TOKEN" ||
      result.error.code === "EXPIRED" ||
      result.error.code === "ALREADY_ACCEPTED" ||
      result.error.code === "AUTH_CREATE_FAILED"
        ? 409
        : result.error.code === "PASSWORD_TOO_SHORT"
          ? 400
          : 500;
    return NextResponse.json(
      { ok: false, error: result.error },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      email: result.email,
      role: result.role,
    },
  });
}
