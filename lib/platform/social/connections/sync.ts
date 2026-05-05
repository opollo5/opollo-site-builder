import "server-only";

import {
  getBundlesocialClient,
  getBundlesocialTeamId,
} from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

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
//      social_connections row and update display_name / status /
//      last_health_check_at based on bundle.social's latest view.
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
};

export async function syncBundlesocialConnections(
  input: SyncConnectionsInput = {},
): Promise<ApiResponse<SyncConnectionsResult>> {
  const client = getBundlesocialClient();
  if (!client) return notConfigured("BUNDLE_SOCIAL_API");
  const teamId = getBundlesocialTeamId();
  if (!teamId) return notConfigured("BUNDLE_SOCIAL_TEAMID");

  let team: {
    socialAccounts?: Array<{
      id: string;
      type: string;
      displayName?: string | null;
      username?: string | null;
      avatarUrl?: string | null;
    }>;
  };
  try {
    team = (await client.team.teamGetTeam({ id: teamId })) as typeof team;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.sync.team_get_failed", {
      err: message,
      team_id: teamId,
    });
    return internal(`bundle.social team.get failed: ${message}`);
  }

  const remoteAccounts = team.socialAccounts ?? [];
  const remoteIds = new Set(remoteAccounts.map((a) => a.id));

  const svc = getServiceRoleClient();

  // Read every existing social_connections row keyed by
  // bundle_social_account_id so we can decide insert/update/disconnect.
  const existing = await svc
    .from("social_connections")
    .select(
      "id, company_id, platform, bundle_social_account_id, display_name, avatar_url, status",
    );
  if (existing.error) {
    logger.error("bundlesocial.sync.local_read_failed", {
      err: existing.error.message,
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
    });
  }

  const result: SyncConnectionsResult = {
    inserted: 0,
    updated: 0,
    marked_disconnected: 0,
    unmapped_skipped: 0,
  };
  const now = new Date().toISOString();

  // Pass 1: walk remote accounts.
  for (const remote of remoteAccounts) {
    const platform = BUNDLE_TO_PLATFORM[remote.type];
    if (!platform) {
      result.unmapped_skipped += 1;
      continue;
    }
    const displayName = (remote.displayName ?? remote.username ?? null) as
      | string
      | null;
    const avatarUrl = (remote.avatarUrl ?? null) as string | null;

    const localRow = existingById.get(remote.id);
    if (localRow) {
      // UPDATE existing — refresh display_name + avatar + status.
      // status flips back to 'healthy' on every successful sync; the
      // webhook handler (S1-17) flips it to auth_required / disconnected
      // when bundle.social signals trouble.
      const update = await svc
        .from("social_connections")
        .update({
          display_name: displayName,
          avatar_url: avatarUrl,
          status: "healthy",
          last_health_check_at: now,
          last_error: null,
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
      // INSERT new — attribute to the company that initiated the
      // connect (passed via the callback).
      const insert = await svc
        .from("social_connections")
        .insert({
          company_id: input.attributeNewToCompanyId,
          platform,
          bundle_social_account_id: remote.id,
          display_name: displayName,
          avatar_url: avatarUrl,
          status: "healthy",
          last_health_check_at: now,
        })
        .select("id");
      if (insert.error) {
        logger.warn("bundlesocial.sync.insert_failed", {
          err: insert.error.message,
          bundle_account_id: remote.id,
        });
      } else {
        result.inserted += 1;
      }
    }
    // else: new account, but no attributeNewToCompanyId → skip
    // silently. A future cron sweep with the right callback context
    // will pick it up.
  }

  // Pass 2: walk local rows; any not in remote = disconnected.
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
