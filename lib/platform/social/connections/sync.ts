import "server-only";

import { getOrCreateBundleSocialTeam } from "@/lib/platform/social/bundle-social/provision";
import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import {
  checkCrossTenantConflict,
  computeIdentityHash,
  emitCrossTenantBlocked,
  emitCrossTenantOverride,
  requiresChannelSelection,
  resolveIdentityFingerprint,
  type BundlesocialPlatformType,
} from "./identity";
import type { SocialPlatform } from "./types";

// ---------------------------------------------------------------------------
// S1-16 — sync social_connections from bundle.social.
//
// Two flows merged into one entry point:
//   1. Post-callback insert: a new account just landed in bundle.
//      social's team. We find any account_id that's NOT yet in
//      social_connections and INSERT a row for the company that
//      initiated the connect (passed via the redirectUrl callback).
//   2. Periodic / manual health refresh: walk every existing
//      social_connections row for the given company and update
//      display_name / status / last_health_check_at based on
//      bundle.social's latest view of that company's team.
//
// This lib doesn't decide which company a new account belongs to —
// the callback handler does (via the redirectUrl param). For health
// refresh, the existing company_id stays put.
//
// Mapping bundle.social platform → our enum (default linkedin_personal
// for ambiguous LINKEDIN; admin can manually correct via a future
// "switch platform type" surface):
//   LINKEDIN → linkedin_personal
//   FACEBOOK → facebook_page
//   TWITTER → x
//   GOOGLE_BUSINESS → gbp
//   (others: skipped with a warn log; they're outside our V1 set)
//
// Caller is responsible for canDo("manage_connections", company_id)
// for the attribution path; the health-refresh path is admin-or-cron.
// ---------------------------------------------------------------------------

const BUNDLE_TO_PLATFORM: Record<string, SocialPlatform> = {
  LINKEDIN: "linkedin_personal",
  FACEBOOK: "facebook_page",
  TWITTER: "x",
  GOOGLE_BUSINESS: "gbp",
};

export type SyncConnectionsInput = {
  // The company whose bundle.social team to sync.
  companyId: string;
  // When set, NEW (unmapped) bundle.social accounts get attributed to
  // this company on insert. Leave undefined for pure health-refresh
  // (no inserts, just updates to existing rows).
  attributeNewToCompanyId?: string | null;
};

export type SyncConnectionsResult = {
  inserted: number;
  updated: number;
  marked_disconnected: number;
  unmapped_skipped: number;
  // Cross-tenant identity-leak defence: count of remote accounts that
  // would have been inserted but were refused because the underlying
  // platform identity is already owned by a different company. Each
  // emits a cross_tenant_blocked event in platform_events.
  cross_tenant_blocked: number;
};

export async function syncBundlesocialConnections(
  input: SyncConnectionsInput,
): Promise<ApiResponse<SyncConnectionsResult>> {
  if (!input.companyId) return notConfigured("companyId");

  const client = getBundlesocialClient();
  if (!client) return notConfigured("BUNDLE_SOCIAL_API");

  const svc = getServiceRoleClient();

  // BSP-8: read every profile for the company that has a provisioned
  // bundle.social team. Each profile has its own team; we walk them all
  // so accounts connected via the BSP-6 admin per-profile flow get
  // synced too (not just default-profile / company-level accounts).
  const profilesRead = await svc
    .from("platform_social_profiles")
    .select("id, bundle_social_team_id, is_default")
    .eq("company_id", input.companyId)
    .not("bundle_social_team_id", "is", null);
  if (profilesRead.error) {
    logger.error("bundlesocial.sync.profiles_read_failed", {
      err: profilesRead.error.message,
      company_id: input.companyId,
    });
    return internal(`Failed to read profiles: ${profilesRead.error.message}`);
  }
  const profileRows = (profilesRead.data ?? []) as Array<{
    id: string;
    bundle_social_team_id: string;
    is_default: boolean;
  }>;

  // Map team_id → profile_id for attribution on insert.
  const profileByTeam = new Map<string, { profileId: string; isDefault: boolean }>();
  for (const p of profileRows) {
    profileByTeam.set(p.bundle_social_team_id, {
      profileId: p.id,
      isDefault: p.is_default,
    });
  }

  // Resolve the default profile id once — used as the attribution
  // target when input.attributeNewToCompanyId is set but the team
  // mapping is missing (defensive only — every team should map post-
  // migration 0119).
  const defaultProfileId =
    profileRows.find((p) => p.is_default)?.id ?? null;

  // Ensure the company's legacy team gets walked too. Pre-BSP-3
  // companies may still have platform_companies.bundle_social_team_id
  // set without a corresponding profile row (shouldn't happen post-
  // migration 0119, but defensive). getOrCreateBundleSocialTeam is
  // idempotent — it returns the existing team id.
  try {
    const companyTeamId = await getOrCreateBundleSocialTeam(input.companyId);
    if (!profileByTeam.has(companyTeamId)) {
      profileByTeam.set(companyTeamId, {
        profileId: defaultProfileId ?? "",
        isDefault: true,
      });
    }
  } catch (err) {
    // If the company's legacy team isn't provisioned and we have at
    // least one profile team, proceed without it. If we have NO teams
    // at all, surface as not-configured.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("bundlesocial.sync.legacy_team_skipped", {
      err: message,
      company_id: input.companyId,
    });
    if (profileByTeam.size === 0) {
      return internal(`No bundle.social teams to sync: ${message}`);
    }
  }

  // Collect every (account, profile, team) tuple across all the company's teams.
  type RemoteAccount = {
    id: string;
    type: string;
    displayName?: string | null;
    username?: string | null;
    avatarUrl?: string | null;
  };
  const remoteByAccountId = new Map<
    string,
    { remote: RemoteAccount; profileId: string | null; teamId: string }
  >();
  // Track per-team success/failure: if EVERY team_get errored, the sync
  // is fundamentally compromised and must surface INTERNAL_ERROR so
  // callers (callback + manual refresh) don't silently mark every
  // healthy connection as disconnected.
  let teamGetSucceeded = 0;
  let lastTeamGetError: string | null = null;
  for (const [teamId, mapping] of profileByTeam) {
    let team: { socialAccounts?: RemoteAccount[] };
    try {
      team = (await client.team.teamGetTeam({ id: teamId })) as typeof team;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastTeamGetError = message;
      logger.warn("bundlesocial.sync.team_get_failed", {
        err: message,
        team_id: teamId,
        company_id: input.companyId,
      });
      // One bad team shouldn't tank the whole sync — skip and continue
      // so other healthy teams still get walked. The all-failed case is
      // handled below.
      continue;
    }
    teamGetSucceeded += 1;
    for (const a of team.socialAccounts ?? []) {
      remoteByAccountId.set(a.id, {
        remote: a,
        profileId: mapping.profileId || null,
        teamId,
      });
    }
  }

  // All-teams-failed surface: if we attempted at least one team_get
  // and none succeeded, refuse to proceed with Pass 2 (which would
  // mark every existing connection as disconnected based on an empty
  // remote set). Surface INTERNAL_ERROR so callers can retry / alert.
  if (profileByTeam.size > 0 && teamGetSucceeded === 0) {
    logger.error("bundlesocial.sync.all_teams_failed", {
      attempted: profileByTeam.size,
      last_err: lastTeamGetError,
      company_id: input.companyId,
    });
    return internal(
      `bundle.social team.get failed for every team (${profileByTeam.size} attempted). Last error: ${lastTeamGetError ?? "unknown"}`,
    );
  }

  const remoteIds = new Set(remoteByAccountId.keys());

  // Read existing social_connections rows for this company.
  const existing = await svc
    .from("social_connections")
    .select(
      "id, company_id, platform, bundle_social_account_id, display_name, avatar_url, status, profile_id, is_personal_mode",
    )
    .eq("company_id", input.companyId);
  if (existing.error) {
    logger.error("bundlesocial.sync.local_read_failed", {
      err: existing.error.message,
      company_id: input.companyId,
    });
    return internal(`Local read failed: ${existing.error.message}`);
  }
  const existingById = new Map<
    string,
    {
      id: string;
      company_id: string;
      platform: SocialPlatform;
      display_name: string | null;
      avatar_url: string | null;
      status: string;
      profile_id: string | null;
      is_personal_mode: boolean;
    }
  >();
  for (const row of existing.data ?? []) {
    existingById.set(row.bundle_social_account_id as string, {
      id: row.id as string,
      company_id: row.company_id as string,
      platform: row.platform as SocialPlatform,
      display_name: (row.display_name as string | null) ?? null,
      avatar_url: (row.avatar_url as string | null) ?? null,
      status: row.status as string,
      profile_id: (row.profile_id as string | null) ?? null,
      is_personal_mode: Boolean(
        (row as { is_personal_mode?: boolean }).is_personal_mode,
      ),
    });
  }

  const result: SyncConnectionsResult = {
    inserted: 0,
    updated: 0,
    marked_disconnected: 0,
    unmapped_skipped: 0,
    cross_tenant_blocked: 0,
  };
  const now = new Date().toISOString();

  // Pass 1: walk remote accounts.
  for (const [bundleAccountId, { remote, profileId, teamId }] of remoteByAccountId) {
    const platform = BUNDLE_TO_PLATFORM[remote.type];
    if (!platform) {
      result.unmapped_skipped += 1;
      continue;
    }
    const remoteDisplayName = (remote.displayName ?? remote.username ?? null) as
      | string
      | null;
    const avatarUrl = (remote.avatarUrl ?? null) as string | null;

    // Cross-tenant identity-leak defence (migration 0122). Resolve the
    // platform-side identity for this account; the result feeds both
    // the conflict check (Layer 2) and the row's status flag (Layer 5).
    // socialAccountGetByType is the source-of-truth read — teamGetTeam
    // sometimes omits externalId/userId and displayName for newly-
    // connected accounts; prefer the identity fingerprint's displayName.
    const rawIdentity = await resolveIdentityFingerprint({
      platform: remote.type as BundlesocialPlatformType,
      teamId,
    });
    // Recompute hash with the DB platform value (e.g. "linkedin_personal")
    // so all stored hashes are consistent with the backfill script and the
    // cross-profile check in checkCrossTenantConflict (which keys on hash
    // equality). resolveIdentityFingerprint hashes with the bundle.social
    // type ("LINKEDIN"), which differs from the DB enum value.
    const identity = {
      ...rawIdentity,
      external_identity_hash: computeIdentityHash(
        platform,
        rawIdentity.external_account_id,
        rawIdentity.external_user_id,
      ),
    };
    // Channel-selection flow (migration 0123): the channel-selection
    // platforms (LINKEDIN/FACEBOOK/INSTAGRAM/YOUTUBE/GOOGLE_BUSINESS)
    // need a channel bound before publishing can succeed. bundle.social
    // returns populated externalId+userId even when channels[] is empty,
    // so the identity-only check below would wrongly mark them
    // 'healthy'. Refuse 'healthy' until the user has either picked a
    // channel OR explicitly opted into personal-mode (LinkedIn).
    // Post-877 fix (#884): externalId (= external_account_id) is null until
    // the user calls socialAccountSetChannel. channels.length > 0 fires
    // immediately after OAuth so it is NOT a valid "channel selected" signal.
    const isPersonal = existingById.get(bundleAccountId)?.is_personal_mode ?? false;
    const needsChannelSelection =
      requiresChannelSelection(remote.type) &&
      identity.external_account_id === null &&
      !isPersonal;
    const status: "healthy" | "pending_identity" = needsChannelSelection
      ? "pending_identity"
      : "healthy";

    // Prefer the display name from socialAccountGetByType (identity) over
    // teamGetTeam (remote) — the former populates userDisplayName even for
    // freshly-connected accounts where teamGetTeam returns null.
    const displayName = rawIdentity.displayName ?? remoteDisplayName;

    const localRow = existingById.get(bundleAccountId);
    if (localRow) {
      // UPDATE existing — refresh display_name + avatar + status. Also
      // backfill profile_id if it was NULL (e.g. row pre-dates BSP-8)
      // and identity columns if they're newly-populated.
      const update = await svc
        .from("social_connections")
        .update({
          display_name: displayName,
          avatar_url: avatarUrl,
          status,
          last_health_check_at: now,
          last_error: null,
          external_account_id: identity.external_account_id,
          external_user_id: identity.external_user_id,
          external_identity_hash: identity.external_identity_hash,
          ...(localRow.profile_id === null && profileId
            ? { profile_id: profileId }
            : {}),
        })
        .eq("id", localRow.id);
      if (update.error) {
        logger.warn("bundlesocial.sync.update_failed", {
          err: update.error.message,
          local_id: localRow.id,
        });
      } else {
        result.updated += 1;
      }
    } else if (input.attributeNewToCompanyId) {
      // INSERT new — attribute to the company that initiated the connect
      // AND to the profile whose team this account lives in. Falls back
      // to the default profile id if the team-profile mapping is missing
      // (defensive — should never fire post-migration 0119).
      const attributedProfileId = profileId ?? defaultProfileId;

      // Cross-tenant identity check BEFORE insert. Block the INSERT if
      // the identity is already owned by a different company (refuse
      // unless override) or by a different profile in the same company
      // (always refuse). Emit audit events on the platform_events table.
      const conflict = await checkCrossTenantConflict({
        platform,
        identity_hash: identity.external_identity_hash,
        external_account_id: identity.external_account_id,
        external_user_id: identity.external_user_id,
        target_company_id: input.attributeNewToCompanyId,
        target_profile_id: attributedProfileId,
      });

      if (!conflict.ok && !conflict.override_allowed) {
        result.cross_tenant_blocked += 1;
        logger.warn("social.cross_tenant_blocked", {
          platform,
          identity_hash: identity.external_identity_hash,
          target_company_id: input.attributeNewToCompanyId,
          target_profile_id: attributedProfileId,
          bundle_account_id: bundleAccountId,
          conflict_code: conflict.code,
          conflicting_company_ids: conflict.conflicting_rows.map((r) => r.company_id),
        });
        void emitCrossTenantBlocked({
          platform,
          identity_hash: identity.external_identity_hash,
          external_account_id: identity.external_account_id,
          external_user_id: identity.external_user_id,
          target_company_id: input.attributeNewToCompanyId,
          target_profile_id: attributedProfileId,
          conflicting_rows: conflict.conflicting_rows,
        });
        continue;
      }
      if (!conflict.ok && conflict.override_allowed) {
        logger.warn("social.cross_tenant_override", {
          platform,
          identity_hash: identity.external_identity_hash,
          target_company_id: input.attributeNewToCompanyId,
          target_profile_id: attributedProfileId,
          bundle_account_id: bundleAccountId,
        });
        void emitCrossTenantOverride({
          platform,
          identity_hash: identity.external_identity_hash,
          external_account_id: identity.external_account_id,
          external_user_id: identity.external_user_id,
          target_company_id: input.attributeNewToCompanyId,
          target_profile_id: attributedProfileId,
          conflicting_rows: conflict.conflicting_rows,
        });
        // Fall through to insert.
      }

      const insert = await svc
        .from("social_connections")
        .insert({
          company_id: input.attributeNewToCompanyId,
          profile_id: attributedProfileId,
          platform,
          bundle_social_account_id: bundleAccountId,
          display_name: displayName,
          avatar_url: avatarUrl,
          status,
          last_health_check_at: now,
          external_account_id: identity.external_account_id,
          external_user_id: identity.external_user_id,
          external_identity_hash: identity.external_identity_hash,
        })
        .select("id");
      if (insert.error) {
        logger.warn("bundlesocial.sync.insert_failed", {
          err: insert.error.message,
          bundle_account_id: bundleAccountId,
        });
      } else {
        result.inserted += 1;
      }
    }
    // else: new account, but no attributeNewToCompanyId → skip.
  }

  // Pass 2: walk local rows; any not in any remote team = disconnected.
  for (const [bundleId, localRow] of existingById.entries()) {
    if (remoteIds.has(bundleId)) continue;
    if (localRow.status === "disconnected") continue;
    const update = await svc
      .from("social_connections")
      .update({
        status: "disconnected",
        last_health_check_at: now,
        disconnected_at: now,
      })
      .eq("id", localRow.id);
    if (update.error) {
      logger.warn("bundlesocial.sync.disconnect_update_failed", {
        err: update.error.message,
        local_id: localRow.id,
      });
    } else {
      result.marked_disconnected += 1;
    }
  }

  return {
    ok: true,
    data: result,
    timestamp: new Date().toISOString(),
  };
}

function notConfigured(envVar: string): ApiResponse<SyncConnectionsResult> {
  logger.error("social.connections.sync.not_configured", { env_var: envVar });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: `${envVar} is not configured.`,
      retryable: false,
      suggested_action: "Provision the env var, then re-deploy.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<SyncConnectionsResult> {
  logger.error("social.connections.sync.internal_error", { message });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}