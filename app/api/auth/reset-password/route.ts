import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { validatePassword } from "@/lib/password-policy";

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password — M14-3.
//
// Sets a new password for the currently authenticated user. Called
// from the /auth/reset-password page after the PKCE code exchange
// (via /api/auth/callback) has already landed a session cookie.
//
// Auth contract: there MUST be an active Supabase session. This
// endpoint does not accept a raw recovery token — that was already
// redeemed by /api/auth/callback. If there's no session, return 401
// with a message pointing at forgot-password.
//
// Password policy: shared with M14-1 and M14-4 via lib/password-policy.
// Server-side validation runs on every call; client-side strength UI
// is additive but never authoritative.
//
// Logging: info on success, warn on auth/validation failures. Never
// log the password itself.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const BodySchema = z.object({
  new_password: z.string().min(1).max(512),
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
          message: "Provide a new password.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const policy = validatePassword(parsed.data.new_password);
  if (!policy.ok) {
    return jsonError("PASSWORD_WEAK", policy.message, 422, true);
  }

  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    logger.warn("reset_password_unauthenticated", {
      outcome: "no_session",
    });
    return jsonError(
      "UNAUTHORIZED",
      "Your reset link has expired. Request a new one from the forgot-password page.",
      401,
    );
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.new_password,
    });
    if (error) {
      const code = error.message.includes("same_password")
        ? "SAME_PASSWORD"
        : "UPDATE_FAILED";
      const message =
        code === "SAME_PASSWORD"
          ? "New password must be different from your current password."
          : "Password update failed. Please try again or contact support with the request id from the response headers.";
      logger.warn("reset_password_supabase_error", {
        user_id: user.id,
        email: user.email,
        error: error.message,
        code,
      });
      return jsonError(code, message, 422, true);
    }

    logger.info("reset_password_success", {
      user_id: user.id,
      email: user.email,
      outcome: "reset",
    });

    return NextResponse.json(
      {
        ok: true,
        data: {
          user_id: user.id,
          note: "Password updated. You remain signed in.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    logger.error("reset_password_internal_error", {
      user_id: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(
      "INTERNAL_ERROR",
      "Password update failed. Please try again.",
      500,
      true,
    );
  }
}
