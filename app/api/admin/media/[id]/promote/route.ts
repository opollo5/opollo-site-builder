import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/admin/media/[id]/promote — C1
//
// Promotes a social_media_asset to scope='global', making it visible in the
// composer media library for all companies.
//
// Admin-only (requireAdminForApi). Uses service-role client to bypass RLS.
//
// Response:
//   200  { ok: true }
//   400  { ok: false, error: { message } }   — invalid id
//   401/403                                  — auth
//   404  { ok: false, error: { message } }   — asset not found
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  const { id } = params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, error: { message: "Invalid asset id." } },
      { status: 400 },
    );
  }

  const svc = getServiceRoleClient();

  // Verify asset exists.
  const { data: existing, error: fetchErr } = await svc
    .from("social_media_assets")
    .select("id, scope")
    .eq("id", id)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json(
      { ok: false, error: { message: "Asset not found." } },
      { status: 404 },
    );
  }

  if (existing.scope === "global") {
    return NextResponse.json({ ok: true, data: { already_global: true } }, { status: 200 });
  }

  const { error: updateErr } = await svc
    .from("social_media_assets")
    .update({ scope: "global" })
    .eq("id", id);

  if (updateErr) {
    logger.error("admin.media.promote.failed", { id, err: updateErr.message });
    return NextResponse.json(
      { ok: false, error: { message: "Failed to promote asset." } },
      { status: 500 },
    );
  }

  logger.info("admin.media.promote.success", { id, by: gate.user?.id });
  return NextResponse.json({ ok: true }, { status: 200 });
}
