import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { countActiveAdmins } from "@/lib/auth";
import { conflict, internalError, notFound, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
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

// AUTH-FOUNDATION P3 — role rename (operator/viewer → admin/user;
// super_admin is the new top tier reserved for hi@opollo.com and
// CANNOT be assigned via this route).
const RoleSchema = z.object({
  role: z.enum(["admin", "user"]),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  req: Request,
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

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = RoleSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { role: 'admin' | 'user' }.", { issues: parsed.error.issues });
  }
  const targetRole = parsed.data.role;

  // Self-modification guard — only enforceable when we know the caller.
  if (gate.user && gate.user.id === userId) {
    return conflict("CANNOT_MODIFY_SELF", "You cannot change your own role. Ask another admin.");
  }

  const svc = getServiceRoleClient();

  const { data: target, error: fetchErr } = await svc
    .from("opollo_users")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (fetchErr) {
    logger.error("admin.users.role.fetch_failed", { user_id: userId, error: fetchErr });
    return internalError("Failed to read user. Please try again or contact support with the request id from the response headers.");
  }
  if (!target) {
    return notFound("No user with that id.");
  }

  const currentRole = target.role as "super_admin" | "admin" | "user";

  // The DB-level guard_super_admin trigger blocks demoting the
  // hi@opollo.com row; surface a clean 409 here so the UI doesn't
  // see a generic 500.
  if (currentRole === "super_admin") {
    return conflict("SUPER_ADMIN_LOCKED", "Super admin cannot be modified.");
  }
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
      return internalError("Failed to count active admins. Please try again or contact support with the request id from the response headers.");
    }
    if (adminCount.count <= 1) {
      return conflict("LAST_ADMIN", "Refusing to demote the last remaining active admin. Promote another admin first, or use the emergency route.");
    }
  }

  const { error: updateErr } = await svc
    .from("opollo_users")
    .update({ role: targetRole })
    .eq("id", userId);
  if (updateErr) {
    logger.error("admin.users.role.update_failed", { user_id: userId, error: updateErr });
    return internalError("Failed to update role. Please try again or contact support with the request id from the response headers.");
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
