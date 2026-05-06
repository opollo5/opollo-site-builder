import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { internalError, notFound, validationError } from "@/lib/http";
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
    return validationError("User id must be a UUID.");
  }

  const svc = getServiceRoleClient();

  const { data: target, error: fetchErr } = await svc
    .from("opollo_users")
    .select("id, revoked_at")
    .eq("id", userId)
    .maybeSingle();
  if (fetchErr) {
    logger.error("admin.users.reinstate.fetch_failed", { user_id: userId, error: fetchErr });
    return internalError("Failed to read user. Please try again or contact support with the request id from the response headers.");
  }
  if (!target) {
    return notFound("No user with that id.");
  }

  // ban_duration: 'none' clears the ban. Supabase quietly accepts this
  // on an already-unbanned user.
  const { error: unbanErr } = await svc.auth.admin.updateUserById(userId, {
    ban_duration: "none",
  });
  if (unbanErr) {
    logger.error("admin.users.reinstate.unban_failed", { user_id: userId, error: unbanErr });
    return internalError("Failed to unban user. Please try again or contact support with the request id from the response headers.");
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
    return internalError("Failed to reinstate user. Please try again or contact support with the request id from the response headers.");
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
