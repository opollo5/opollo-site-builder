import { NextResponse, type NextRequest } from "next/server";

import {
  internalError,
  invalidState,
  notFound,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { unsetChannel } from "@/lib/platform/social/connections/channels";
import { loadConnectionWithTeam } from "@/lib/platform/social/connections/route-helpers";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/connections/[id]/unset-channel
//
// Clears the channel binding on bundle.social and flips the row back
// to 'pending_identity'. Used to let a user re-pick without re-running
// OAuth, and as step 1 of the Layer 6 disconnect ordering.
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

  const result = await unsetChannel({
    teamId: conn.teamId,
    platform: conn.bundlePlatform,
  });
  if (!result.ok) {
    logger.error("social.channels.unset_failed", {
      connection_id: conn.id,
      platform: conn.bundlePlatform,
      code: result.error.code,
      message: result.error.message,
    });
    if (result.error.code === "RECEIVER_NOT_CONFIGURED")
      return invalidState(result.error.message);
    if (result.error.code === "PLATFORM_NOT_SUPPORTED")
      return invalidState(result.error.message);
    if (result.error.code === "UPSTREAM_REJECTED")
      return invalidState(result.error.message);
    return internalError(result.error.message);
  }

  const svc = getServiceRoleClient();
  const now = new Date().toISOString();
  // Channel-cleared rows revert to 'pending_identity' so the publishing
  // gate refuses them and the customer page renders the picker prompt.
  // Identity columns stay populated — the user OAuth-grant hasn't been
  // revoked, only the channel binding has been cleared.
  const update = await svc
    .from("social_connections")
    .update({
      status: "pending_identity",
      is_personal_mode: false,
      last_health_check_at: now,
    })
    .eq("id", conn.id);
  if (update.error) {
    logger.error("social.channels.unset_update_failed", {
      connection_id: conn.id,
      err: update.error.message,
    });
    return internalError(`Failed to record channel unset: ${update.error.message}`);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { connection_id: conn.id },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
