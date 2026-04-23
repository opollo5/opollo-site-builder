import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { buildAuthRedirectUrl } from "@/lib/auth-redirect";
import { logger } from "@/lib/logger";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password — M14-3.
//
// Triggers a Supabase password-reset email for `email`. The email's
// link points at /api/auth/callback?next=/auth/reset-password which
// exchanges the PKCE code for a session and lands the user on the
// reset form.
//
// Response contract: this endpoint ALWAYS returns a success-shaped
// response for any syntactically-valid email, regardless of whether
// that email is actually registered. Rationale: a different response
// for "email exists" vs "email doesn't exist" lets anyone enumerate
// the admin roster by hitting this endpoint with every email they're
// curious about. The cost is that a legit user who typos their email
// doesn't get explicit feedback — they see "if that email is in our
// system, you'll get a link shortly," which matches every
// well-behaved SaaS flow.
//
// Rate limiter: `password_reset` bucket, keyed on the normalised
// email address. 5 requests per email per hour. A single email being
// flooded is the attack shape this bucket stops; IP-based limiting
// is in the `login` + `auth_callback` buckets for the other shapes.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.string().email().max(320),
});

function jsonError(
  code: string,
  message: string,
  status: number,
  retryable = false,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

function successEnvelope(email: string): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      data: {
        email,
        note: "If an account exists for this email, a reset link has been sent. Check your inbox (and spam folder) for the next few minutes.",
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Provide a valid email address.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const email = parsed.data.email.trim().toLowerCase();

  const rl = await checkRateLimit("password_reset", `email:${email}`);
  if (!rl.ok) {
    logger.warn("forgot_password_rate_limited", { email });
    return rateLimitExceeded(rl);
  }

  const redirectTo = buildAuthRedirectUrl(
    "/api/auth/callback?next=%2Fauth%2Freset-password",
    req,
  );

  const svc = getServiceRoleClient();

  try {
    const { error } = await svc.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      // Log at warn — Supabase failures here (rate-limited upstream,
      // invalid template config, etc.) are ops-relevant — but still
      // return the success envelope so the response shape doesn't
      // leak whether the email is registered. The specific failure
      // reason is in the structured log.
      logger.warn("forgot_password_supabase_error", {
        email,
        error: error.message,
      });
      return successEnvelope(email);
    }

    logger.info("forgot_password_requested", { email });
    return successEnvelope(email);
  } catch (err) {
    // Unexpected failures (network / library crash) are the one case
    // we surface as a 500 instead of masking behind the success
    // envelope. A silent 500 would let an attacker distinguish "real
    // error" from "email not registered" if the auth service is
    // degraded — but surfacing a 500 here is about ops signal, not
    // enumeration. Caller sees a generic retryable error.
    logger.error("forgot_password_internal_error", {
      email,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(
      "INTERNAL_ERROR",
      "Password reset request failed. Please try again.",
      500,
      true,
    );
  }
}
