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
};

export type InitiateProfileConnectError =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "RECEIVER_NOT_CONFIGURED"; message: string }
  | { code: "INTERNAL_ERROR"; message: string };

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
      },
    });
    url = resp.url;
  } catch (err) {
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
