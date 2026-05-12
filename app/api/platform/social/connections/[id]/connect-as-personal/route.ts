import { NextResponse, type NextRequest } from "next/server";

import {
  internalError,
  invalidState,
  notFound,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { loadConnectionWithTeam } from "@/lib/platform/social/connections/route-helpers";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/connections/[id]/connect-as-personal
//
// Marks a connection as personal-mode: the user explicitly chose to
// publish under their own profile (LinkedIn personal urn) instead of
// picking a company page. is_personal_mode=true, status='healthy', and
// no set-channel call is made on bundle.social — they accept publishing
// against the user's own profile by default when no channel is bound.
//
// LinkedIn-only today; extensible. Refuses if the platform doesn't
// support personal-mode (everything but LINKEDIN).
//
// Gate: canDo("manage_connections", company_id of the connection).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const loaded = await loadConnectionWithTeam(idCheck.value);
  if (!loaded.ok) {
    if (loaded.error.code === "NOT_FOUND") return notFound(loaded.error.message);
    return invalidState(loaded.error.message);
  }
  const conn = loaded.data;

  const gate = await requireCanDoForApi(conn.company_id, "manage_connections");
  if (gate.kind === "deny") return gate.response;

  if (conn.bundlePlatform !== "LINKEDIN") {
    return invalidState(
      "Personal-mode is only supported for LinkedIn today. " +
        "Other platforms require a channel selection.",
    );
  }

  const svc = getServiceRoleClient();
  const now = new Date().toISOString();
  const update = await svc
    .from("social_connections")
    .update({
      status: "healthy",
      is_personal_mode: true,
      last_health_check_at: now,
      last_error: null,
    })
    .eq("id", conn.id);
  if (update.error) {
    logger.error("social.channels.personal_mode_update_failed", {
      connection_id: conn.id,
      err: update.error.message,
    });
    return internalError(
      `Failed to record personal-mode selection: ${update.error.message}`,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { connection_id: conn.id, is_personal_mode: true },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
