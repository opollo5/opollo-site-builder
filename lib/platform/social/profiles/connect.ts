import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";

import { getOrCreateBundleSocialTeamForProfile } from "./provision-team";

// ---------------------------------------------------------------------------
// BSP-6 — direct OAuth connect for per-profile social accounts.
//
// Uses bundle.social's socialAccount.socialAccountConnect endpoint
// (NOT socialAccountCreatePortalLink — that's the hosted-portal flow).
// Direct OAuth means:
//   * Fewer hops (we land on the OAuth provider's screen, not on a
//     bundle.social-branded portal page first).
//   * Per-platform invocation — caller specifies type up front.
//   * disableAutoLogin can force an account picker on FB/IG/TikTok.
//
// Returns an OAuth URL the caller opens in a popup. The redirect comes
// back to /api/platform/social/connections/callback?company_id=...&popup=1
// (same callback the BSP hosted-portal flow uses) which handles the
// postMessage + window.close() handshake.
//
// Gate: caller must have already authorised the operator + verified
// the profileId belongs to the company; this helper does not enforce.
// ---------------------------------------------------------------------------

export type ProfileSocialPlatform =
  | "TIKTOK"
  | "YOUTUBE"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "TWITTER"
  | "THREADS"
  | "LINKEDIN"
  | "PINTEREST"
  | "REDDIT"
  | "MASTODON"
  | "DISCORD"
  | "SLACK"
  | "BLUESKY"
  | "GOOGLE_BUSINESS";

export type InitiateProfileConnectInput = {
  profileId: string;
  platform: ProfileSocialPlatform;
  redirectUrl: string;
  // Optional. When true, adds provider-specific flags to FB/IG/TikTok
  // to avoid auto-login. Useful for adding a SECOND account on the
  // same browser session.
  disableAutoLogin?: boolean;
  // Optional. Facebook and Instagram only — when true, requests
  // business_management, ads_management, ads_read scopes for business
  // page management. Customer-facing connect should pass this for FB/IG.
  withBusinessScope?: boolean;
};

export type InitiateProfileConnectError =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "RECEIVER_NOT_CONFIGURED"; message: string }
  // bundle.social rejected the connect request with a 4xx status. Typical
  // causes: a connection of this (team, platform) already exists, a
  // platform-specific flag is unsupported, or the team has been suspended.
  // Carries the bundle.social-supplied detail so the route can surface a
  // useful message instead of a generic 500.
  | { code: "UPSTREAM_REJECTED"; message: string; upstreamStatus: number }
  | { code: "INTERNAL_ERROR"; message: string };

// Narrow check for the bundlesocial SDK's ApiError shape. Avoids importing
// the SDK's class symbol (not exported in a stable place) — we duck-type
// on the four fields the SDK populates: status, statusText, body, url.
function isBundleSocialApiError(err: unknown): err is {
  name: string;
  status: number;
  statusText?: string;
  body?: unknown;
  url?: string;
} {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "ApiError" &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

// bundle.social returns error bodies as JSON. Extract whichever message
// shape arrives — flat `{ message }`, nested `{ error: { message } }`, or
// raw string — so the operator-visible string is meaningful instead of
// the literal status code string ("400") that Error.message defaults to.
function extractUpstreamMessage(body: unknown, statusText?: string): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.length > 0) return o.message;
    if (o.error && typeof o.error === "object") {
      const e = o.error as Record<string, unknown>;
      if (typeof e.message === "string" && e.message.length > 0) return e.message;
    }
  }
  if (typeof body === "string" && body.length > 0) return body;
  return statusText && statusText.length > 0 ? statusText : "bundle.social rejected the request.";
}

export type InitiateProfileConnectResult =
  | { ok: true; data: { url: string; teamId: string } }
  | { ok: false; error: InitiateProfileConnectError };

export async function initiateProfileConnect(
  input: InitiateProfileConnectInput,
): Promise<InitiateProfileConnectResult> {
  if (!input.profileId) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "profileId is required." },
    };
  }
  if (!input.redirectUrl) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "redirectUrl is required." },
    };
  }

  const client = getBundlesocialClient();
  if (!client) {
    return {
      ok: false,
      error: {
        code: "RECEIVER_NOT_CONFIGURED",
        message: "BUNDLE_SOCIAL_API is not configured.",
      },
    };
  }

  let teamId: string;
  try {
    teamId = await getOrCreateBundleSocialTeamForProfile(input.profileId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.profile.connect.provision_failed", {
      profile_id: input.profileId,
      err: msg,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: msg },
    };
  }

  logger.info("bundlesocial.profile.connect.request", {
    profile_id: input.profileId,
    team_id: teamId,
    platform: input.platform,
  });

  let url: string;
  try {
    const resp = await client.socialAccount.socialAccountConnect({
      requestBody: {
        type: input.platform,
        teamId,
        redirectUrl: input.redirectUrl,
        ...(input.disableAutoLogin === true ? { disableAutoLogin: true } : {}),
        ...(input.withBusinessScope === true ? { withBusinessScope: true } : {}),
      },
    });
    url = resp.url;
  } catch (err) {
    // Two failure shapes worth distinguishing:
    //   1. bundle.social ApiError (4xx / 5xx with structured body) — extract
    //      the upstream message so the operator sees what bundle.social
    //      actually said, not the literal status code echoed as message.
    //   2. Anything else (network failure, SDK bug, etc.) — fall through
    //      to INTERNAL_ERROR with the message as-is.
    if (isBundleSocialApiError(err)) {
      const upstreamMessage = extractUpstreamMessage(err.body, err.statusText);
      logger.error("bundlesocial.profile.connect.sdk_failed", {
        profile_id: input.profileId,
        team_id: teamId,
        platform: input.platform,
        upstream_status: err.status,
        upstream_status_text: err.statusText ?? null,
        upstream_body: err.body ?? null,
        upstream_url: err.url ?? null,
        err: upstreamMessage,
      });
      // 4xx is a client/state issue (duplicate connection, flag not
      // supported on this platform, team suspended). Map to
      // UPSTREAM_REJECTED so the caller can return 409 INVALID_STATE
      // with a useful message instead of a misleading 500.
      if (err.status >= 400 && err.status < 500) {
        return {
          ok: false,
          error: {
            code: "UPSTREAM_REJECTED",
            message: upstreamMessage,
            upstreamStatus: err.status,
          },
        };
      }
      return {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: upstreamMessage },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.profile.connect.sdk_failed", {
      profile_id: input.profileId,
      team_id: teamId,
      platform: input.platform,
      err: msg,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: msg },
    };
  }

  logger.info("bundlesocial.profile.connect.response", {
    profile_id: input.profileId,
    team_id: teamId,
    platform: input.platform,
    url_length: url.length,
  });

  return { ok: true, data: { url, teamId } };
}

// BSP-7 — disconnect a per-profile social account.
//
// bundle.social's socialAccountDisconnect endpoint identifies the
// account by (teamId, platform type) — not by account id. There can
// only be one account of a given platform per team, so this is well-
// defined. Returns ok:true regardless of whether an account existed
// before — disconnecting an already-disconnected (team, type) is a no-op.

export type DisconnectProfileAccountInput = {
  profileId: string;
  platform: ProfileSocialPlatform;
};

export type DisconnectProfileAccountResult =
  | { ok: true; data: { teamId: string; platform: ProfileSocialPlatform } }
  | {
      ok: false;
      error: { code: string; message: string };
    };

export async function disconnectProfileAccount(
  input: DisconnectProfileAccountInput,
): Promise<DisconnectProfileAccountResult> {
  if (!input.profileId) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "profileId is required." },
    };
  }
  const client = getBundlesocialClient();
  if (!client) {
    return {
      ok: false,
      error: {
        code: "RECEIVER_NOT_CONFIGURED",
        message: "BUNDLE_SOCIAL_API is not configured.",
      },
    };
  }

  // Resolve the profile's team id. Disconnect against an unprovisioned
  // profile is a no-op error — we never created a team there, so there's
  // nothing to disconnect from.
  let teamId: string;
  try {
    teamId = await getOrCreateBundleSocialTeamForProfile(input.profileId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: msg },
    };
  }

  logger.info("bundlesocial.profile.disconnect.request", {
    profile_id: input.profileId,
    team_id: teamId,
    platform: input.platform,
  });

  try {
    await client.socialAccount.socialAccountDisconnect({
      requestBody: { type: input.platform, teamId },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.profile.disconnect.sdk_failed", {
      profile_id: input.profileId,
      team_id: teamId,
      platform: input.platform,
      err: msg,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: msg },
    };
  }

  logger.info("bundlesocial.profile.disconnect.response", {
    profile_id: input.profileId,
    team_id: teamId,
    platform: input.platform,
  });

  return { ok: true, data: { teamId, platform: input.platform } };
}

// Read a profile's bundle.social team detail (including the list of
// connected social accounts). Returns null if the profile has not yet
// been provisioned a team. Caller is responsible for auth gating.
export async function readProfileTeamAccounts(input: {
  teamId: string;
}): Promise<
  | {
      ok: true;
      data: {
        accounts: Array<{
          id: string;
          type: string;
          username: string | null;
          displayName: string | null;
        }>;
      };
    }
  | { ok: false; error: { code: string; message: string } }
> {
  const client = getBundlesocialClient();
  if (!client) {
    return {
      ok: false,
      error: {
        code: "RECEIVER_NOT_CONFIGURED",
        message: "BUNDLE_SOCIAL_API is not configured.",
      },
    };
  }

  try {
    const resp = await client.team.teamGetTeam({ id: input.teamId });
    return {
      ok: true,
      data: {
        accounts: (resp.socialAccounts ?? []).map((a) => ({
          id: a.id,
          type: a.type,
          username: a.username ?? null,
          displayName: a.displayName ?? null,
        })),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("bundlesocial.profile.team.read_failed", {
      team_id: input.teamId,
      err: msg,
    });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: msg },
    };
  }
}
