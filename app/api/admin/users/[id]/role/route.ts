import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { countActiveAdmins } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/[id]/role — M2d-2.
//
// Admin-only. Promotes or demotes a user to one of the three roles.
// Role changes are "soft" events in this codebase: lib/auth.ts
// getCurrentUser re-reads opollo_users.role on every request, so the
// demoted caller sees the new role on their very next page load with
// no session sweep needed. See the comment in auth.ts and the
// regression test "reflects a server-side role demotion on the next
// getCurrentUser call" for the primary pin.
//
// Guardrails:
//
//   CANNOT_MODIFY_SELF (409)
//     An admin cannot change their own role. Prevents an admin from
//     accidentally demoting themselves out of the admin surface and
//     then needing the emergency route to recover. Applies only when
//     the caller identity is known (flag-on path); under flag-off /
//     kill-switch we don't know who is calling.
//
//   LAST_ADMIN (409)
//     We will not demote the last remaining admin. Without this, a
//     single mis-click from the only admin's colleague would lock the
//     org out of /admin/users entirely and force an emergency-key
//     recovery. The emergency route (M2c-3) is a valid recovery path
//     if this check ever blocks something the operator really wants.
//
// Same role → no-op, 200 with { changed: false }. Keeps the UI cell
// idempotent when a dropdown triggers onChange for the already-set
// value.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RoleSchema = z.object({
  role: z.enum(["admin", "operator", "viewer"]),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorJson(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, ...(extra ?? {}) },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  const userId = params.id;
  if (!UUID_RE.test(userId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "User id must be a UUID.",
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = RoleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { role: 'admin' | 'operator' | 'viewer' }.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }
  const targetRole = parsed.data.role;

  // Self-modification guard — only enforceable when we know the caller.
  if (gate.user && gate.user.id === userId) {
    return errorJson(
      "CANNOT_MODIFY_SELF",
      "You cannot change your own role. Ask another admin.",
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
    logger.error("admin.users.role.fetch_failed", { user_id: userId, error: fetchErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to read user. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }
  if (!target) {
    return errorJson("NOT_FOUND", "No user with that id.", 404);
  }

  const currentRole = target.role as "admin" | "operator" | "viewer";
  if (currentRole === targetRole) {
    return NextResponse.json(
      {
        ok: true,
        data: { id: userId, role: targetRole, changed: false },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  // Last-admin guard — only matters when demoting away from 'admin'.
  // Counts via countActiveAdmins() (role='admin' AND revoked_at IS NULL)
  // so revoked admins don't prop up the count. See docs/ENDPOINT_AUDIT_2026-04-24.md
  // finding #2 for the prior drift where this route counted revoked admins.
  if (currentRole === "admin" && targetRole !== "admin") {
    const adminCount = await countActiveAdmins();
    if (!adminCount.ok) {
      logger.error("admin.users.role.count_failed", { user_id: userId, error: adminCount.error });
      return errorJson(
        "INTERNAL_ERROR",
        "Failed to count active admins. Please try again or contact support with the request id from the response headers.",
        500,
      );
    }
    if (adminCount.count <= 1) {
      return errorJson(
        "LAST_ADMIN",
        "Refusing to demote the last remaining active admin. Promote another admin first, or use the emergency route.",
        409,
      );
    }
  }

  const { error: updateErr } = await svc
    .from("opollo_users")
    .update({ role: targetRole })
    .eq("id", userId);
  if (updateErr) {
    logger.error("admin.users.role.update_failed", { user_id: userId, error: updateErr });
    return errorJson(
      "INTERNAL_ERROR",
      "Failed to update role. Please try again or contact support with the request id from the response headers.",
      500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { id: userId, role: targetRole, changed: true },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
