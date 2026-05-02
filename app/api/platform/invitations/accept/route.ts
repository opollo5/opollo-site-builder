import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { acceptInvitation } from "@/lib/platform/invitations";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/platform/invitations/accept — P2-3.
//
// Public — the magic-link token in the body IS the proof of identity.
// No requireCanDoForApi gate (the inviter has already authorised this
// recipient by sending the invitation; the token bounds the action to
// exactly that one acceptance).
//
// Rate-limited per-IP on the "invite-accept" bucket so a leaked-link
// brute-force attempt against random tokens dies before it can run.
// 32-byte SHA-256 keyspace is computationally safe; rate limiting is
// defence in depth.
//
// Errors:
//   400 VALIDATION_FAILED — body shape, password too short, blank name.
//   401 INVALID_TOKEN     — token doesn't resolve to any invitation.
//   409 ALREADY_ACCEPTED  — invitation already used.
//   409 REVOKED           — invitation was revoked.
//   410 EXPIRED           — past expires_at.
//   400 EMAIL_MISMATCH    — body email doesn't match invitation.email.
//   409 AUTH_USER_EXISTS  — supabase auth.users already has this email
//                           (stale state from a prior aborted accept;
//                           user can sign in / password-reset).
//   429 RATE_LIMITED      — abuse defence.
//   500 INTERNAL_ERROR    — DB / Supabase admin API failure. Partial
//                           failures (auth user created, follow-up DB
//                           writes failed) are logged with
//                           partial_failure: true so an operator can
//                           triage. Recovery is documented in the lib
//                           comment.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AcceptSchema = z.object({
  token: z.string().min(32).max(256),
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  full_name: z.string().min(1).max(254),
});

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

const ACCEPT_ERROR_STATUS: Record<string, number> = {
  VALIDATION_FAILED: 400,
  INVALID_TOKEN: 401,
  EMAIL_MISMATCH: 400,
  REVOKED: 409,
  ALREADY_ACCEPTED: 409,
  EXPIRED: 410,
  AUTH_USER_EXISTS: 409,
  INTERNAL_ERROR: 500,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit("invite_accept", `ip:${getClientIp(req)}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = AcceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message:
            "Body must be { token: string, email: string, password: string (min 8), full_name: string }.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await acceptInvitation({
    rawToken: parsed.data.token,
    email: parsed.data.email,
    password: parsed.data.password,
    fullName: parsed.data.full_name,
  });

  if (!result.ok) {
    const status = ACCEPT_ERROR_STATUS[result.error.code] ?? 500;
    if (status >= 500) {
      logger.error("platform.invitations.accept.failed", {
        code: result.error.code,
        message: result.error.message,
      });
    }
    return errorJson(result.error.code, result.error.message, status);
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        user_id: result.userId,
        company_id: result.companyId,
        role: result.role,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
