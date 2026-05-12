import { NextResponse, type NextRequest } from "next/server";

import {
  internalError,
  invalidState,
  notFound,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { refreshChannels } from "@/lib/platform/social/connections/channels";
import {
  CHANNEL_SELECTION_PLATFORMS,
} from "@/lib/platform/social/connections/identity";
import { loadConnectionWithTeam } from "@/lib/platform/social/connections/route-helpers";

// ---------------------------------------------------------------------------
// GET /api/platform/social/connections/[id]/channels
//
// Re-fetches the channel list from the platform side (LinkedIn / FB /
// IG / YT / GBP) for a specific social_connections row, and returns
// the normalised picker payload.
//
// Gate: canDo("manage_connections", company_id of the connection).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

  if (!CHANNEL_SELECTION_PLATFORMS.has(conn.bundlePlatform)) {
    return invalidState(
      `Platform '${conn.bundlePlatform}' is not a channel-selection platform.`,
    );
  }

  const result = await refreshChannels({
    teamId: conn.teamId,
    platform: conn.bundlePlatform,
  });
  if (!result.ok) {
    logger.error("social.channels.list_failed", {
      connection_id: conn.id,
      platform: conn.bundlePlatform,
      code: result.error.code,
      message: result.error.message,
    });
    if (result.error.code === "RECEIVER_NOT_CONFIGURED")
      return invalidState(result.error.message);
    if (result.error.code === "UPSTREAM_REJECTED")
      return invalidState(result.error.message);
    return internalError(result.error.message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { channels: result.data.channels },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
