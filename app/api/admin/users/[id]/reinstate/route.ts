import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/users/[id]/reinstate — M2d-4.
//
// Inverse of /revoke. Clears the Supabase ban and blanks
// opollo_users.revoked_at so the user can sign in and pass the
// getCurrentUser gate again. Idempotent: calling against an already-
// active user returns 200 with changed: false.
//
// No self / last-admin guards here — an admin un-revoking themself or
// another admin is fine by construction (you can't revoke the last
// admin in the first place).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("user_mgmt", `user:${gate.user?.id ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const userId = params.id;
  if (!UUID_RE.test(userId)) {
    return errorJson("VALIDATION_FAILED", "User id must be a UUID.", 400);
  }

  const svc = getServiceRoleClient();

  const { data: target, error: fetchErr } = await svc
    .from("opollo_users")
    .select("id, revoked_at")
    .eq("id", userId)
    .maybeSingle();
  if (fetchErr) {
    logger.error("admin.users.reinstate.fetch_failed", { user_id: userId, error: fetchErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to read user. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }
  if (!target) {
    return errorJson("NOT_FOUND", "No user with that id.", 404);
  }

  // ban_duration: 'none' clears the ban. Supabase quietly accepts this
  // on an already-unbanned user.
  const { error: unbanErr } = await svc.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (unbanErr) {
    logger.error("admin.users.reinstate.unban_failed", { user_id: userId, error: unbanErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to unban user. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }

  if (!target.revoked_at) {
    return NextResponse.json(
      {
        ok: true,
        data: { id: userId, revoked: false, changed: false },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  const { error: clearErr } = await svc
    .from("opollo_users")
    .update({ revoked_at: null })
    .eq("id", userId);
  if (clearErr) {
    logger.error("admin.users.reinstate.clear_revoked_failed", { user_id: userId, error: clearErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to reinstate user. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { id: userId, revoked: false, changed: true },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
