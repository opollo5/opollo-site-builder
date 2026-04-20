import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
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
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

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
    return errorJson(
      "INTERNAL_ERROR",
      `Failed to read target user: ${fetchErr.message}`,
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
    return errorJson(
      "INTERNAL_ERROR",
      `Failed to unban user in auth.users: ${unbanErr.message}`,
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
    return errorJson(
      "INTERNAL_ERROR",
      `Failed to clear revoked_at: ${clearErr.message}`,
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
