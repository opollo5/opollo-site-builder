import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";

import {
  CHANNEL_SELECTION_PLATFORMS,
  requiresChannelSelection,
  type BundlesocialPlatformType,
} from "./identity";

// ---------------------------------------------------------------------------
// Channel-selection flow — SDK wrappers around bundle.social's
// set-channel / unset-channel / refresh-channels endpoints.
//
// Context: bundle.social's docs at
// https://info.bundle.social/api-reference/connect-social-accounts
// describe a two-step flow for LINKEDIN / FACEBOOK / INSTAGRAM /
// YOUTUBE / GOOGLE_BUSINESS:
//   1. OAuth via socialAccountConnect creates a socialAccount with
//      channels:[].
//   2. The user picks a specific channel (org page, FB page, IG page,
//      YT channel, GBP location). The app calls
//      socialAccountSetChannel to bind it.
//
// Until step 2 lands, the account exists but cannot publish. Customers
// see a generic "OAuth error" on the bundle.social dashboard.
//
// The wrappers below are platform-agnostic by design. They normalise
// the SDK's loose Channel shape into a `Channel` we render directly
// in the picker UI; the per-platform subtext is computed here, not in
// the React layer (so /channels GET is what the modal renders, no
// platform branching client-side).
//
// SDK types pinned from node_modules/bundlesocial/dist/index.d.ts:
//   socialAccountRefreshChannels — type 'DISCORD' | 'SLACK' | 'REDDIT'
//     | 'PINTEREST' | 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN' | 'YOUTUBE'
//     | 'GOOGLE_BUSINESS' (9 platforms — superset of channel-selection
//     because Discord/Slack/Reddit/Pinterest fan-out to channels too,
//     but those use a different UX).
//   socialAccountSetChannel    — 5 platforms (the channel-selection set)
//   socialAccountUnsetChannel  — 5 platforms (the channel-selection set)
//
// No separate `getChannels` method exists. Cached channels[] is read
// via socialAccountGetByType (already wrapped in identity.ts's
// resolveIdentityFingerprint).
// ---------------------------------------------------------------------------

// Platforms refreshChannels accepts. Wider than CHANNEL_SELECTION_PLATFORMS
// — see SDK docs.
const REFRESH_CHANNELS_PLATFORMS: ReadonlySet<BundlesocialPlatformType> =
  new Set([
    "LINKEDIN",
    "FACEBOOK",
    "INSTAGRAM",
    "YOUTUBE",
    "GOOGLE_BUSINESS",
    "DISCORD",
    "SLACK",
    "REDDIT",
    "PINTEREST",
  ]);

export type Channel = {
  id: string;
  name: string;
  // Sub-line under the channel name in the picker. Per platform:
  //   LINKEDIN_ORG       → username (org urn slug)
  //   FACEBOOK_PAGE      → username (page handle)
  //   INSTAGRAM_ACCOUNT  → @username
  //   YOUTUBE_CHANNEL    → username / handle
  //   GBP_LOCATION       → physical address
  // Bundle.social's SDK doesn't return follower / subscriber counts on
  // this endpoint, so the subtext is identifying info only — not metrics.
  subtext: string | null;
  avatarUrl: string | null;
  // Tag indicating the rendered channel shape. Useful for tests and
  // for any picker logic that wants to render platform-specific icons.
  kind:
    | "LINKEDIN_ORG"
    | "FACEBOOK_PAGE"
    | "INSTAGRAM_ACCOUNT"
    | "YOUTUBE_CHANNEL"
    | "GBP_LOCATION"
    | "OTHER";
};

export type ChannelOpsError =
  | { code: "VALIDATION_FAILED"; message: string }
  | { code: "RECEIVER_NOT_CONFIGURED"; message: string }
  | { code: "PLATFORM_NOT_SUPPORTED"; message: string }
  | { code: "UPSTREAM_REJECTED"; message: string; upstreamStatus: number }
  | { code: "INTERNAL_ERROR"; message: string };

export type ChannelOpsResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ChannelOpsError };

// Narrow check for the bundlesocial SDK's ApiError shape. Mirrors the
// helper in lib/platform/social/profiles/connect.ts — we duck-type
// rather than import the class symbol.
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
  return statusText && statusText.length > 0
    ? statusText
    : "bundle.social rejected the request.";
}

type RawChannel = {
  id: string;
  name?: string | null;
  username?: string | null;
  address?: string | null;
  avatarUrl?: string | null;
};

export function normalizeChannel(
  platform: BundlesocialPlatformType,
  raw: RawChannel,
): Channel {
  const kind: Channel["kind"] = (
    {
      LINKEDIN: "LINKEDIN_ORG",
      FACEBOOK: "FACEBOOK_PAGE",
      INSTAGRAM: "INSTAGRAM_ACCOUNT",
      YOUTUBE: "YOUTUBE_CHANNEL",
      GOOGLE_BUSINESS: "GBP_LOCATION",
    } as const
  )[platform as "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS"] ??
    "OTHER";

  // Per-platform subtext picks the most-identifying field. Most
  // platforms surface a username; GBP uses physical address.
  const subtext =
    platform === "GOOGLE_BUSINESS"
      ? raw.address ?? null
      : platform === "INSTAGRAM" && raw.username
        ? `@${raw.username.replace(/^@/, "")}`
        : raw.username ?? null;

  return {
    id: raw.id,
    name: raw.name ?? raw.username ?? raw.id,
    subtext,
    avatarUrl: raw.avatarUrl ?? null,
    kind,
  };
}

// ---------------------------------------------------------------------------
// refreshChannels — re-fetches the channel list from the platform side.
// Use after OAuth completes (the freshly-connected account hasn't seen
// its channels listed yet) and when the user clicks "refresh channels".
// ---------------------------------------------------------------------------

export async function refreshChannels(args: {
  teamId: string;
  platform: BundlesocialPlatformType;
}): Promise<ChannelOpsResult<{ channels: Channel[] }>> {
  if (!args.teamId) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "teamId is required." },
    };
  }
  if (!REFRESH_CHANNELS_PLATFORMS.has(args.platform)) {
    return {
      ok: false,
      error: {
        code: "PLATFORM_NOT_SUPPORTED",
        message: `refreshChannels does not support platform '${args.platform}'.`,
      },
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

  try {
    // SDK narrows the type union to refresh-supported platforms; we've
    // already gated on REFRESH_CHANNELS_PLATFORMS above so the cast is
    // safe (TS can't infer the narrowing through Set.has).
    const resp = (await client.socialAccount.socialAccountRefreshChannels({
      requestBody: {
        type: args.platform as
          | "DISCORD"
          | "SLACK"
          | "REDDIT"
          | "PINTEREST"
          | "FACEBOOK"
          | "INSTAGRAM"
          | "LINKEDIN"
          | "YOUTUBE"
          | "GOOGLE_BUSINESS",
        teamId: args.teamId,
      },
    })) as { channels?: RawChannel[] | null };
    const channels = (resp.channels ?? []).map((c) =>
      normalizeChannel(args.platform, c),
    );
    return { ok: true, data: { channels } };
  } catch (err) {
    return mapSdkError(err, "refresh_channels", args);
  }
}

// ---------------------------------------------------------------------------
// getChannels — reads cached channels without re-fetching from the
// platform side. Cheaper than refreshChannels (no upstream LinkedIn /
// FB call). Use to populate the picker quickly on initial load; the
// modal can offer a "Refresh" affordance backed by refreshChannels.
// ---------------------------------------------------------------------------

export async function getChannels(args: {
  teamId: string;
  platform: BundlesocialPlatformType;
}): Promise<ChannelOpsResult<{ channels: Channel[] }>> {
  if (!args.teamId) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "teamId is required." },
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

  try {
    const resp = (await client.socialAccount.socialAccountGetByType({
      teamId: args.teamId,
      type: args.platform,
    })) as { channels?: RawChannel[] | null };
    const channels = (resp.channels ?? []).map((c) =>
      normalizeChannel(args.platform, c),
    );
    return { ok: true, data: { channels } };
  } catch (err) {
    return mapSdkError(err, "get_channels", args);
  }
}

// ---------------------------------------------------------------------------
// setChannel — commits the user's pick. After success, callers should
// re-resolve identity (setChannel changes externalId for LinkedIn / GBP
// / YT) and flip the social_connections row from pending_identity →
// healthy. The route handler does that — this module is a thin wrapper.
// ---------------------------------------------------------------------------

export async function setChannel(args: {
  teamId: string;
  platform: BundlesocialPlatformType;
  channelId: string;
}): Promise<ChannelOpsResult<{ externalId: string | null; userId: string | null }>> {
  if (!args.teamId || !args.channelId) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "teamId and channelId are required.",
      },
    };
  }
  if (!requiresChannelSelection(args.platform)) {
    return {
      ok: false,
      error: {
        code: "PLATFORM_NOT_SUPPORTED",
        message: `setChannel does not support platform '${args.platform}'.`,
      },
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

  try {
    const resp = (await client.socialAccount.socialAccountSetChannel({
      requestBody: {
        type: args.platform as
          | "FACEBOOK"
          | "INSTAGRAM"
          | "LINKEDIN"
          | "YOUTUBE"
          | "GOOGLE_BUSINESS",
        teamId: args.teamId,
        channelId: args.channelId,
      },
    })) as { externalId?: string | null; userId?: string | null };
    return {
      ok: true,
      data: {
        externalId: resp.externalId ?? null,
        userId: resp.userId ?? null,
      },
    };
  } catch (err) {
    return mapSdkError(err, "set_channel", args);
  }
}

// ---------------------------------------------------------------------------
// unsetChannel — clears the binding without disconnecting. Per the
// bundle.social docs: drafts that referenced the old channel become
// genuine drafts (recoverable), rather than ghost-pointing at a dead
// connection. Use this:
//   * Before a full disconnect (Layer 6 ordering).
//   * To let the user re-pick without re-running OAuth.
// ---------------------------------------------------------------------------

export async function unsetChannel(args: {
  teamId: string;
  platform: BundlesocialPlatformType;
}): Promise<ChannelOpsResult<{ unset: true }>> {
  if (!args.teamId) {
    return {
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "teamId is required." },
    };
  }
  if (!requiresChannelSelection(args.platform)) {
    return {
      ok: false,
      error: {
        code: "PLATFORM_NOT_SUPPORTED",
        message: `unsetChannel does not support platform '${args.platform}'.`,
      },
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

  try {
    await client.socialAccount.socialAccountUnsetChannel({
      requestBody: {
        type: args.platform as
          | "FACEBOOK"
          | "INSTAGRAM"
          | "LINKEDIN"
          | "YOUTUBE"
          | "GOOGLE_BUSINESS",
        teamId: args.teamId,
      },
    });
    return { ok: true, data: { unset: true } };
  } catch (err) {
    return mapSdkError(err, "unset_channel", args);
  }
}

function mapSdkError<T>(
  err: unknown,
  op: string,
  args: { teamId: string; platform: BundlesocialPlatformType },
): ChannelOpsResult<T> {
  if (isBundleSocialApiError(err)) {
    const upstreamMessage = extractUpstreamMessage(err.body, err.statusText);
    logger.error("social.channels.sdk_failed", {
      op,
      team_id: args.teamId,
      platform: args.platform,
      upstream_status: err.status,
      upstream_status_text: err.statusText ?? null,
      upstream_body: err.body ?? null,
      upstream_url: err.url ?? null,
      err: upstreamMessage,
    });
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
  logger.error("social.channels.sdk_failed", {
    op,
    team_id: args.teamId,
    platform: args.platform,
    err: msg,
  });
  return {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: msg },
  };
}

export { CHANNEL_SELECTION_PLATFORMS, requiresChannelSelection };
