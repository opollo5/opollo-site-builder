import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  conflict,
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
  emitCrossTenantOverride,
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
  // Explicit operator override: when true and the target company has
  // allow_cross_tenant_identity=true, bypass the cross-tenant block and
  // emit a cross_tenant_override audit event instead of refusing.
  force: z.boolean().optional(),
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

  const tenantCheck = await checkCrossTenantConflict({
    platform: conn.platform,
    identity_hash: externalIdentityHash,
    external_account_id: fingerprint.external_account_id,
    external_user_id: fingerprint.external_user_id,
    target_company_id: conn.company_id,
    target_profile_id: conn.profile_id,
    excludeConnectionId: conn.id,
  });
  if (!tenantCheck.ok) {
    const forceOverride = parsed.data.force === true && tenantCheck.override_allowed;

    if (!forceOverride) {
      // Emit audit + return structured 409 the UI can act on.
      logger.warn("social.channels.set_cross_tenant_blocked", {
        connection_id: conn.id,
        platform: conn.platform,
        target_company_id: conn.company_id,
        conflict_code: tenantCheck.code,
        override_allowed: tenantCheck.override_allowed,
      });
      void emitCrossTenantBlocked({
        platform: conn.platform,
        identity_hash: externalIdentityHash,
        external_account_id: fingerprint.external_account_id,
        external_user_id: fingerprint.external_user_id,
        target_company_id: conn.company_id,
        target_profile_id: conn.profile_id,
        actor_user_id: gate.userId,
        conflicting_rows: tenantCheck.conflicting_rows,
      });

      // Look up the conflicting company name for the UI prompt.
      const conflictingRow = tenantCheck.conflicting_rows[0] ?? null;
      let conflictingCompany: string | null = null;
      if (conflictingRow) {
        const svc2 = getServiceRoleClient();
        const companyRead = await svc2
          .from("platform_companies")
          .select("name")
          .eq("id", conflictingRow.company_id)
          .maybeSingle();
        conflictingCompany =
          (companyRead.data as { name?: string } | null)?.name ?? null;
      }

      return conflict(
        "CROSS_TENANT_CONFLICT",
        "This channel is already attached to another company on Opollo. " +
          "If you manage social media for both companies, use the override option.",
        {
          conflicting_company: conflictingCompany,
          conflicting_channel_name: conflictingRow?.display_name ?? null,
          override_allowed: tenantCheck.override_allowed,
        },
      );
    }

    // force=true + override_allowed: proceed and emit override audit.
    logger.info("social.channels.set_cross_tenant_override", {
      connection_id: conn.id,
      platform: conn.platform,
      target_company_id: conn.company_id,
      actor_user_id: gate.userId,
    });
    void emitCrossTenantOverride({
      platform: conn.platform,
      identity_hash: externalIdentityHash,
      external_account_id: fingerprint.external_account_id,
      external_user_id: fingerprint.external_user_id,
      target_company_id: conn.company_id,
      target_profile_id: conn.profile_id,
      actor_user_id: gate.userId,
      conflicting_rows: tenantCheck.conflicting_rows,
    });
  }

  const selectedChannel = fingerprint.channels.find(
    (c) => c.id === parsed.data.channel_id,
  );
  const channelDisplayName = selectedChannel?.name ?? null;

  const svc = getServiceRoleClient();
  const now = new Date().toISOString();
  const update = await svc
    .from("social_connections")
    .update({
      status: "healthy",
      display_name: channelDisplayName,
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

  void svc.from("platform_events").insert({
    company_id: conn.company_id,
    actor_id: gate.userId,
    event_type: "connection_channel_selected",
    entity_type: "social_connection",
    entity_id: conn.id,
    payload: {
      connection_id: conn.id,
      channel_id: parsed.data.channel_id,
      channel_name: channelDisplayName,
      previous_external_account_id: conn.external_account_id,
      previous_display_name: conn.display_name,
    },
  });

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
