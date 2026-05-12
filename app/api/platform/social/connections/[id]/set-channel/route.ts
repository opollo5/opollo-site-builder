import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  internalError,
  invalidState,
  notFound,
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { setChannel } from "@/lib/platform/social/connections/channels";
import {
  checkCrossTenantConflict,
  computeIdentityHash,
  emitCrossTenantBlocked,
  resolveIdentityFingerprint,
} from "@/lib/platform/social/connections/identity";
import { loadConnectionWithTeam } from "@/lib/platform/social/connections/route-helpers";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/connections/[id]/set-channel
//
// Body: { channel_id: string }
//
// Commits a channel selection on bundle.social, then refreshes our
// row's identity columns (set-channel changes externalId for LinkedIn
// org / FB Page / IG / YT / GBP), runs the cross-tenant conflict check
// against the freshly-resolved identity, and flips status to 'healthy'
// (or refuses on cross-tenant conflict).
//
// Gate: canDo("manage_connections", company_id of the connection).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SetChannelSchema = z.object({
  channel_id: z.string().min(1).max(512),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = parseBodyWith(SetChannelSchema, body);
  if (!parsed.ok) return parsed.response;

  const loaded = await loadConnectionWithTeam(idCheck.value);
  if (!loaded.ok) {
    if (loaded.error.code === "NOT_FOUND") return notFound(loaded.error.message);
    return invalidState(loaded.error.message);
  }
  const conn = loaded.data;

  const gate = await requireCanDoForApi(conn.company_id, "manage_connections");
  if (gate.kind === "deny") return gate.response;

  const setResult = await setChannel({
    teamId: conn.teamId,
    platform: conn.bundlePlatform,
    channelId: parsed.data.channel_id,
  });
  if (!setResult.ok) {
    logger.error("social.channels.set_failed", {
      connection_id: conn.id,
      platform: conn.bundlePlatform,
      code: setResult.error.code,
      message: setResult.error.message,
    });
    if (setResult.error.code === "RECEIVER_NOT_CONFIGURED")
      return invalidState(setResult.error.message);
    if (setResult.error.code === "PLATFORM_NOT_SUPPORTED")
      return invalidState(setResult.error.message);
    if (setResult.error.code === "UPSTREAM_REJECTED")
      return invalidState(setResult.error.message);
    return internalError(setResult.error.message);
  }

  // Re-resolve identity now that channel is bound — externalId can
  // change (LinkedIn org urn ≠ LinkedIn person urn, FB page id ≠ user
  // id, etc.). Then run the cross-tenant detector against the freshly-
  // resolved identity before flipping to 'healthy'. The identity layer
  // PR #868 introduced runs at every write point; this is the new write.
  const fingerprint = await resolveIdentityFingerprint({
    platform: conn.bundlePlatform,
    teamId: conn.teamId,
  });
  const externalIdentityHash = computeIdentityHash(
    conn.platform,
    fingerprint.external_account_id,
    fingerprint.external_user_id,
  );

  const conflict = await checkCrossTenantConflict({
    platform: conn.platform,
    identity_hash: externalIdentityHash,
    external_account_id: fingerprint.external_account_id,
    external_user_id: fingerprint.external_user_id,
    target_company_id: conn.company_id,
    target_profile_id: conn.profile_id,
    excludeConnectionId: conn.id,
  });
  if (!conflict.ok && !conflict.override_allowed) {
    logger.warn("social.channels.set_cross_tenant_blocked", {
      connection_id: conn.id,
      platform: conn.platform,
      target_company_id: conn.company_id,
      conflict_code: conflict.code,
    });
    void emitCrossTenantBlocked({
      platform: conn.platform,
      identity_hash: externalIdentityHash,
      external_account_id: fingerprint.external_account_id,
      external_user_id: fingerprint.external_user_id,
      target_company_id: conn.company_id,
      target_profile_id: conn.profile_id,
      actor_user_id: gate.userId,
      conflicting_rows: conflict.conflicting_rows,
    });
    return invalidState(
      "This channel is already attached to another company on Opollo. " +
        "Contact support to set up multi-company sharing.",
    );
  }

  const svc = getServiceRoleClient();
  const now = new Date().toISOString();
  const update = await svc
    .from("social_connections")
    .update({
      status: "healthy",
      external_account_id: fingerprint.external_account_id,
      external_user_id: fingerprint.external_user_id,
      external_identity_hash: externalIdentityHash,
      is_personal_mode: false,
      last_health_check_at: now,
      last_error: null,
    })
    .eq("id", conn.id);
  if (update.error) {
    logger.error("social.channels.set_update_failed", {
      connection_id: conn.id,
      err: update.error.message,
    });
    return internalError(`Failed to record channel selection: ${update.error.message}`);
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        connection_id: conn.id,
        channel_id: parsed.data.channel_id,
        external_account_id: fingerprint.external_account_id,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
