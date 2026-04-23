import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { validatePassword } from "@/lib/password-policy";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/account/change-password — M14-4.
//
// Session-authenticated password change. Differs from /api/auth/reset-
// password (M14-3) by requiring the caller to demonstrate knowledge of
// the CURRENT password before the change goes through. That gate is
// what makes this surface safe to expose to an already-signed-in user
// at /account/security — a session hijacker who lands a stolen cookie
// still can't rotate the password without the original secret.
//
// Current-password verification is a short-lived `signInWithPassword`
// against an ephemeral anon client. Success == caller knows the
// password. Failure (any reason) == we refuse the update with
// INCORRECT_CURRENT_PASSWORD — we don't distinguish "wrong password"
// from "Supabase rate-limited your check" to keep the response
// uninformative to brute-forcers.
//
// Password policy: shared with M14-1 / M14-3 via lib/password-policy.
// Logging: info on success, warn on each failure branch.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const BodySchema = z.object({
  current_password: z.string().min(1).max(512),
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

async function verifyCurrentPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Configuration failure — treat as "cannot verify" (fail-closed).
    // Logged at the caller.
    return false;
  }
  // Ephemeral client — NO session persistence, NO refresh. The call
  // is a read of "do these credentials validate?" not a sign-in.
  const probe = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  return !error;
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
          message:
            "Provide current_password and new_password in the request body.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);
  if (!user) {
    logger.warn("change_password_unauthenticated", { outcome: "no_session" });
    return jsonError(
      "UNAUTHORIZED",
      "Sign in to change your password.",
      401,
    );
  }
  if (!user.email) {
    // Defensive — every opollo_users row has an email, but if it ever
    // doesn't we can't verify the current password without one.
    logger.error("change_password_missing_email", { user_id: user.id });
    return jsonError(
      "INTERNAL_ERROR",
      "Account is missing an email; contact an admin.",
      500,
    );
  }

  const rl = await checkRateLimit("login", `user:${user.id}`);
  if (!rl.ok) {
    logger.warn("change_password_rate_limited", {
      user_id: user.id,
      email: user.email,
    });
    return rateLimitExceeded(rl);
  }

  const { current_password, new_password } = parsed.data;

  // Server-side policy check on the NEW password. Short-circuits
  // before we spend a signInWithPassword round-trip on a value we'd
  // reject anyway.
  const policy = validatePassword(new_password);
  if (!policy.ok) {
    return jsonError("PASSWORD_WEAK", policy.message, 422, true);
  }

  if (current_password === new_password) {
    return jsonError(
      "SAME_PASSWORD",
      "New password must be different from your current password.",
      422,
      true,
    );
  }

  const verified = await verifyCurrentPassword(user.email, current_password);
  if (!verified) {
    logger.warn("change_password_incorrect_current", {
      user_id: user.id,
      email: user.email,
    });
    return jsonError(
      "INCORRECT_CURRENT_PASSWORD",
      "Your current password is incorrect.",
      403,
      true,
    );
  }

  try {
    const { error } = await supabase.auth.updateUser({
      password: new_password,
    });
    if (error) {
      const code = error.message.includes("same_password")
        ? "SAME_PASSWORD"
        : "UPDATE_FAILED";
      const message =
        code === "SAME_PASSWORD"
          ? "New password must be different from your current password."
          : `Password update failed: ${error.message}`;
      logger.warn("change_password_supabase_error", {
        user_id: user.id,
        email: user.email,
        error: error.message,
        code,
      });
      return jsonError(code, message, 422, true);
    }

    logger.info("change_password_success", {
      user_id: user.id,
      email: user.email,
      outcome: "changed",
    });

    return NextResponse.json(
      {
        ok: true,
        data: {
          user_id: user.id,
          note: "Password updated. You remain signed in on this device.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    logger.error("change_password_internal_error", {
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
