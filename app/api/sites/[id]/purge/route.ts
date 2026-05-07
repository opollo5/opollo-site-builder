import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import { purgeSite } from "@/lib/sites";

// Spec 01 §3.2 — POST DELETE /api/sites/[id]/purge.
//
// Hard-delete: walks the FK dependency graph at runtime and deletes
// every dependent row in reverse-depth order, then deletes the sites
// row. The audit row is inserted in the same transaction as the
// cascade so a rollback of the delete also rolls back the audit.
//
// Distinct from DELETE /api/sites/[id] which is the soft-archive
// (status='removed' flip). Both routes coexist; this one is gated
// to super_admin only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Site id must be a UUID.",
        },
      },
      { status: 400 },
    );
  }

  const result = await purgeSite(params.id, {
    actorId: gate.user?.id ?? null,
    actorEmail: gate.user?.email ?? null,
  });

  if (!result.ok) {
    const status = result.error.code === "NOT_FOUND" ? 404 : 500;
    if (status === 500) {
      logger.error("sites.purge.route_failure", {
        site_id: params.id,
        error_code: result.error.code,
        details: result.error.details ?? null,
      });
    }
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: result.error.code,
          message: result.error.message,
        },
      },
      { status },
    );
  }

  revalidatePath("/admin/sites");
  return NextResponse.json({ ok: true, data: result.data });
}
