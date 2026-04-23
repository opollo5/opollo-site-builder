import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { countActiveAdmins } from "@/lib/auth";
import { revokeUserSessions } from "@/lib/auth-revoke";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/users/[id]/revoke — M2d-4.
//
// Full "kick them out and keep them out" combo:
//
//   1. auth.admin.updateUserById(id, { ban_duration: '876000h' })
//      Bans the auth user (~100 years). signInWithPassword then fails
//      for them until we unban. Without this, revokeUserSessions alone
//      only kicks current sessions — the user can immediately sign back
//      in with a fresh iat that passes the revoked_at gate.
//
//   2. revokeUserSessions(id) from M2c-3. Stamps
//      opollo_users.revoked_at = now() and sweeps sessions +
//      refresh_tokens. The revoked_at stamp is what
//      getCurrentUser uses to reject any still-cached access token
//      on the very next request.
//
// Guardrails match M2d-2's role change:
//   - CANNOT_MODIFY_SELF (409) — admin cannot revoke themself.
//   - LAST_ADMIN (409) — refuse to revoke the sole remaining admin.
//   - NOT_FOUND (404) — no opollo_users row for that id.
//
// Reinstate (unban + clear revoked_at) lives in its sibling route so
// the two surfaces stay symmetric and easy to reason about.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Supabase's ban_duration is a Go duration string. 876_000h ≈ 100 years —
// long enough to be effectively permanent without hitting any int32
// parser limits.
const BAN_FOREVER = "876000h";

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

  if (gate.user && gate.user.id === userId) {
    return errorJson(
      "CANNOT_MODIFY_SELF",
      "You cannot revoke your own access. Ask another admin.",
      409,
    );
  }

  const svc = getServiceRoleClient();

  const { data: target, error: fetchErr } = await svc
    .from("opollo_users")
    .select("id, role")
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

  if (target.role === "admin") {
    // Shared counter with /admin/users/[id]/role — both routes must
    // agree on "active admin" = role='admin' AND revoked_at IS NULL.
    // See lib/auth.ts#countActiveAdmins for the definition.
    const adminCount = await countActiveAdmins();
    if (!adminCount.ok) {
      return errorJson(
        "INTERNAL_ERROR",
        `Failed to count active admins: ${adminCount.error}`,
        500,
      );
    }
    if (adminCount.count <= 1) {
      return errorJson(
        "LAST_ADMIN",
        "Refusing to revoke the last active admin. Promote another admin first, or use the emergency route.",
        409,
      );
    }
  }

  const { error: banErr } = await svc.auth.admin.updateUserById(userId, {
    ban_duration: BAN_FOREVER,
  });
  if (banErr) {
    return errorJson(
      "INTERNAL_ERROR",
      `Failed to ban user in auth.users: ${banErr.message}`,
      500,
    );
  }

  try {
    await revokeUserSessions(userId);
  } catch (err) {
    // The ban already landed, so the immediate effect is the same even
    // if the session sweep fails. Surface it so operators know to
    // retry, but don't lie about success.
    const message = err instanceof Error ? err.message : String(err);
    return errorJson(
      "INTERNAL_ERROR",
      `User banned, but session sweep failed: ${message}`,
      500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { id: userId, revoked: true },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
