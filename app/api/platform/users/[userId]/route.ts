import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, notFound, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DELETE /api/platform/users/[userId] — D1 hard delete.
//
// Deletes auth.users entry for the given user, which cascades via FK to
// platform_users (ON DELETE CASCADE) then platform_company_users.
// Gate: caller must be an admin of the company the target user belongs to.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UserIdSchema = z.string().uuid();

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { userId: string } },
): Promise<NextResponse> {
  const idParse = UserIdSchema.safeParse(params.userId);
  if (!idParse.success) return validationError("userId must be a UUID.");
  const userId = idParse.data;

  const svc = getServiceRoleClient();

  // Resolve which company this user belongs to (V1: one user, one company).
  const membership = await svc
    .from("platform_company_users")
    .select("company_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (membership.error) {
    logger.error("platform.users.delete.membership_lookup_failed", {
      user_id: userId,
      err: membership.error.message,
    });
    return internalError("Membership lookup failed.");
  }
  if (!membership.data) return notFound("No platform user with that id.");

  const gate = await requireCanDoForApi(membership.data.company_id as string, "manage_users");
  if (gate.kind === "deny") return gate.response;

  // Hard delete via auth admin. Cascades: auth.users → platform_users →
  // platform_company_users (both FK ON DELETE CASCADE).
  const { error: deleteError } = await svc.auth.admin.deleteUser(userId);
  if (deleteError) {
    logger.error("platform.users.delete.auth_delete_failed", {
      user_id: userId,
      err: deleteError.message,
    });
    return internalError("User deletion failed.");
  }

  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
