import { NextResponse } from "next/server";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/ops/reset-admin-password — M14-1 permanent admin reset.
//
// Break-glass for the case where an admin is locked out and the self-
// service Supabase password-reset email path is not usable (misconfig,
// email not delivered, spam-filtered, Supabase auth down). Designed to
// live in production as an ops tool, not a one-off script — the
// emergency-key gate is the same one guarding /api/emergency and
// /api/ops/self-probe.
//
// Authentication: OPOLLO_EMERGENCY_KEY header. 32-char minimum.
// Constant-time comparison. Accepts either:
//
//   X-Opollo-Emergency-Key: <key>
//   Authorization: Bearer <key>
//
// Target scoping: the user named in the body must exist in
// opollo_users with role='admin'. Operator / viewer passwords are NOT
// resettable through this endpoint — an emergency-key compromise must
// not become a full tenant takeover. The guard bounds the blast
// radius to the same set of users /api/emergency's revoke_user
// already covers.
//
// Logging: structured logger with { request_id, email, outcome }.
// Password is never logged. Failure cases at warn, success at info.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

const MIN_KEY_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;

const BodySchema = z.object({
  email: z.string().email().max(320),
  new_password: z.string().min(MIN_PASSWORD_LENGTH).max(256),
});

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    const filler = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, filler);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function extractKey(req: Request): string | null {
  const custom = req.headers.get("x-opollo-emergency-key");
  if (custom) return custom.trim();
  const bearer = req.headers.get("authorization");
  if (bearer && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return null;
}

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

export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.OPOLLO_EMERGENCY_KEY;
  if (!expected || expected.length < MIN_KEY_LENGTH) {
    logger.warn("ops_reset_admin_password_not_configured", {
      reason: "OPOLLO_EMERGENCY_KEY unset or too short",
    });
    return jsonError(
      "EMERGENCY_NOT_CONFIGURED",
      "Emergency access is not configured on this deployment.",
      503,
    );
  }

  const provided = extractKey(req);
  if (!provided || !constantTimeEqual(provided, expected)) {
    logger.warn("ops_reset_admin_password_unauthorized", {
      outcome: "bad_key",
    });
    return jsonError("UNAUTHORIZED", "Invalid emergency key.", 401);
  }

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
            "Invalid request body. Expected { email, new_password } with a valid email and a password of at least 12 characters.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const { email, new_password } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const svc = getServiceRoleClient();

  try {
    // Confirm the target is a current (non-deleted) admin. Supabase's
    // auth.users table is the source of truth for auth identity, but
    // opollo_users is the source of truth for role. The join path:
    // opollo_users.id == auth.users.id; we look up opollo_users by
    // email-equivalent, then use the id to drive the auth admin call.
    const { data: opolloUser, error: opolloErr } = await svc
      .from("opollo_users")
      .select("id, role, deleted_at")
      .eq("email", normalizedEmail)
      .is("deleted_at", null)
      .maybeSingle();

    if (opolloErr) {
      logger.error("ops_reset_admin_password_lookup_failed", {
        email: normalizedEmail,
        error: opolloErr.message,
      });
      return jsonError(
        "INTERNAL_ERROR",
        "Admin lookup failed. See server logs.",
        500,
        true,
      );
    }

    if (!opolloUser) {
      logger.warn("ops_reset_admin_password_not_found", {
        email: normalizedEmail,
        outcome: "no_matching_user",
      });
      return jsonError(
        "NOT_FOUND",
        "No admin user found with that email.",
        404,
      );
    }

    if (opolloUser.role !== "admin") {
      logger.warn("ops_reset_admin_password_wrong_role", {
        email: normalizedEmail,
        role: opolloUser.role,
        outcome: "non_admin_target",
      });
      return jsonError(
        "FORBIDDEN",
        "This endpoint can only reset passwords for users with role='admin'.",
        403,
      );
    }

    const { error: updateErr } = await svc.auth.admin.updateUserById(
      opolloUser.id,
      { password: new_password },
    );

    if (updateErr) {
      logger.error("ops_reset_admin_password_update_failed", {
        email: normalizedEmail,
        user_id: opolloUser.id,
        error: updateErr.message,
      });
      return jsonError(
        "INTERNAL_ERROR",
        "Password update failed. See server logs.",
        500,
        true,
      );
    }

    logger.info("ops_reset_admin_password_success", {
      email: normalizedEmail,
      user_id: opolloUser.id,
      outcome: "reset",
    });

    return NextResponse.json(
      {
        ok: true,
        data: {
          email: normalizedEmail,
          user_id: opolloUser.id,
          note: "Password reset. Existing sessions are NOT revoked — use POST /api/emergency {action:'revoke_user'} if the account is suspected compromised.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("ops_reset_admin_password_internal_error", {
      email: normalizedEmail,
      error: message,
    });
    return jsonError(
      "INTERNAL_ERROR",
      "Password reset failed. See server logs.",
      500,
      true,
    );
  }
}
