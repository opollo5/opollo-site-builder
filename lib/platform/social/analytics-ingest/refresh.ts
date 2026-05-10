import "server-only";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

import {
  analyticsPlatformFor,
  type BundleSocialAnalyticsPlatform,
} from "./platform-map";

// ---------------------------------------------------------------------------
// Analytics ingest — pulls bundle.social-sourced engagement metrics into
// social_profile_analytics_snapshots + social_post_analytics_snapshots.
//
// Two refresh surfaces:
//
//   refreshAnalyticsForAllProfiles()
//     — daily cron entry point. Iterates every provisioned profile and
//       every connected social account on each profile. Used by
//       /api/cron/social-analytics-refresh.
//
//   refreshAnalyticsForProfile({ profileId })
//     — single-profile refresh. Used by the dashboard's manual "Refresh"
//       button (rate-limited at the SDK side by bundle.social: 5/day per
//       team per platform).
//
// Both share the same per-account pipeline:
//
//   1. analyticsGetSocialAccountAnalytics — upsert into
//      social_profile_analytics_snapshots.
//   2. analyticsGetBulkPostAnalytics (in pages of 60 — SDK limit) over
//      the trailing-60-day post-id window — upsert into
//      social_post_analytics_snapshots.
//
// First-insert vs subsequent-update semantics for post snapshots:
//
//   - First row for a (profile, bundle_post_id, snapshot_date) writes the
//     full record including title / content / media_urls / post_url.
//   - Subsequent rows for the same row only refresh metric columns.
//     This preserves the original post content past bundle.social's
//     ~30-day raw retention.
//
// The 60-day post window is wider than bundle.social's 30-day retention
// because we want to catch posts that exist in their system before they
// purge. After the first cron tick that picks up a post, our snapshot
// row carries the content permanently — refreshes only update metrics.
// ---------------------------------------------------------------------------

export type RefreshOutcome = {
  profile_id: string;
  accounts_refreshed: number;
  account_failures: number;
  posts_refreshed: number;
  post_failures: number;
  errors: Array<{ kind: string; message: string }>;
};

export type RefreshAllResult = {
  profiles_refreshed: number;
  profiles_failed: number;
  totals: {
    accounts_refreshed: number;
    account_failures: number;
    posts_refreshed: number;
    post_failures: number;
  };
};

const POST_WINDOW_DAYS = 60;
const BULK_POST_ANALYTICS_PAGE_SIZE = 60; // bundle.social SDK limit

export async function refreshAnalyticsForAllProfiles(): Promise<RefreshAllResult> {
  const svc = getServiceRoleClient();
  const { data: profiles, error } = await svc
    .from("platform_social_profiles")
    .select("id, company_id, bundle_social_team_id")
    .not("bundle_social_team_id", "is", null);

  if (error) {
    throw new Error(`Failed to list profiles: ${error.message}`);
  }

  const totals = {
    accounts_refreshed: 0,
    account_failures: 0,
    posts_refreshed: 0,
    post_failures: 0,
  };
  let profilesRefreshed = 0;
  let profilesFailed = 0;

  for (const profile of profiles ?? []) {
    try {
      const outcome = await refreshAnalyticsForProfile({
        profileId: profile.id as string,
      });
      profilesRefreshed += 1;
      totals.accounts_refreshed += outcome.accounts_refreshed;
      totals.account_failures += outcome.account_failures;
      totals.posts_refreshed += outcome.posts_refreshed;
      totals.post_failures += outcome.post_failures;
    } catch (err) {
      profilesFailed += 1;
      logger.error("social.analytics.refresh.profile_failed", {
        profile_id: profile.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    profiles_refreshed: profilesRefreshed,
    profiles_failed: profilesFailed,
    totals,
  };
}

export async function refreshAnalyticsForProfile(input: {
  profileId: string;
}): Promise<RefreshOutcome> {
  const outcome: RefreshOutcome = {
    profile_id: input.profileId,
    accounts_refreshed: 0,
    account_failures: 0,
    posts_refreshed: 0,
    post_failures: 0,
    errors: [],
  };

  const client = getBundlesocialClient();
  if (!client) {
    outcome.errors.push({
      kind: "config",
      message: "BUNDLE_SOCIAL_API not configured",
    });
    return outcome;
  }

  const svc = getServiceRoleClient();
  const { data: profile, error: profileErr } = await svc
    .from("platform_social_profiles")
    .select("id, bundle_social_team_id")
    .eq("id", input.profileId)
    .maybeSingle();

  if (profileErr) {
    throw new Error(`Profile read failed: ${profileErr.message}`);
  }
  if (!profile || !profile.bundle_social_team_id) {
    outcome.errors.push({
      kind: "not_provisioned",
      message: "Profile has no bundle.social team",
    });
    return outcome;
  }

  const teamId = profile.bundle_social_team_id as string;

  // Connected accounts for this profile.
  const { data: connections, error: connErr } = await svc
    .from("social_connections")
    .select("id, platform, bundle_social_account_id, status")
    .eq("profile_id", input.profileId)
    .is("deleted_at", null);

  if (connErr) {
    throw new Error(`Connections read failed: ${connErr.message}`);
  }

  // Group connections by bundle.social platform type so we issue at most
  // one analytics call per (team, platform). E.g. linkedin_personal +
  // linkedin_company collapse to one LINKEDIN refresh.
  const byBundlePlatform = new Map<
    BundleSocialAnalyticsPlatform,
    Array<{ platform: SocialPlatform; bundle_social_account_id: string }>
  >();
  for (const c of connections ?? []) {
    const internalPlatform = c.platform as SocialPlatform;
    const bp = analyticsPlatformFor(internalPlatform);
    if (!bp) continue; // X / unsupported — skip silently
    const list = byBundlePlatform.get(bp) ?? [];
    list.push({
      platform: internalPlatform,
      bundle_social_account_id: c.bundle_social_account_id as string,
    });
    byBundlePlatform.set(bp, list);
  }

  const today = new Date().toISOString().slice(0, 10);

  for (const [bundlePlatform, conns] of byBundlePlatform.entries()) {
    try {
      const accountAnalytics =
        await client.analytics.analyticsGetSocialAccountAnalytics({
          teamId,
          platformType: bundlePlatform,
        });

      // bundle.social returns ONE socialAccount per call (per platform per
      // team), but a profile may have multiple connections that map to
      // the same bundle platform (linkedin_personal + linkedin_company).
      // We upsert ONE row per (profile, internal-platform, account) for
      // the day. If the API only knows about one of our local connection
      // rows, the others stay un-refreshed for the tick.
      const socialAccountId = accountAnalytics.socialAccount.id;
      const matchedConn = conns.find(
        (c) => c.bundle_social_account_id === socialAccountId,
      );
      if (!matchedConn) {
        // The API account id doesn't match any of our stored connections.
        // Skip — the next sync will rectify the mapping.
        continue;
      }

      const item = accountAnalytics.items?.[0];
      if (!item) {
        outcome.account_failures += 1;
        outcome.errors.push({
          kind: "no_data",
          message: `No analytics items for ${bundlePlatform}`,
        });
        continue;
      }

      const profileUpsert = await svc.from("social_profile_analytics_snapshots").upsert(
        {
          profile_id: input.profileId,
          platform: matchedConn.platform,
          bundle_social_account_id: matchedConn.bundle_social_account_id,
          snapshot_date: today,
          period_kind: "snapshot",
          followers: item.followers ?? null,
          following: item.following ?? null,
          post_count: item.postCount ?? null,
          impressions: item.impressions ?? null,
          impressions_unique: item.impressionsUnique ?? null,
          views: item.views ?? null,
          views_unique: item.viewsUnique ?? null,
          likes: item.likes ?? null,
          comments: item.comments ?? null,
          raw: accountAnalytics as unknown as Record<string, unknown>,
        },
        {
          onConflict:
            "profile_id,platform,bundle_social_account_id,snapshot_date",
        },
      );
      if (profileUpsert.error) {
        outcome.account_failures += 1;
        outcome.errors.push({
          kind: "upsert",
          message: profileUpsert.error.message,
        });
        continue;
      }
      outcome.accounts_refreshed += 1;

      // Post analytics — refresh the trailing 60 days of posts for this
      // (team, platform). We pull the list of imported posts (capped),
      // then fan out bulk analytics calls in pages of 60.
      const postOutcome = await refreshPostsForAccount({
        client,
        svc,
        profileId: input.profileId,
        internalPlatform: matchedConn.platform,
        bundlePlatform,
        teamId,
        bundleSocialAccountId: matchedConn.bundle_social_account_id,
        today,
      });
      outcome.posts_refreshed += postOutcome.refreshed;
      outcome.post_failures += postOutcome.failures;
      for (const e of postOutcome.errors) outcome.errors.push(e);
    } catch (err) {
      outcome.account_failures += 1;
      outcome.errors.push({
        kind: "sdk",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcome;
}

async function refreshPostsForAccount(args: {
  client: NonNullable<ReturnType<typeof getBundlesocialClient>>;
  svc: ReturnType<typeof getServiceRoleClient>;
  profileId: string;
  internalPlatform: SocialPlatform;
  bundlePlatform: BundleSocialAnalyticsPlatform;
  teamId: string;
  bundleSocialAccountId: string;
  today: string;
}): Promise<{
  refreshed: number;
  failures: number;
  errors: Array<{ kind: string; message: string }>;
}> {
  const errors: Array<{ kind: string; message: string }> = [];
  let refreshed = 0;
  let failures = 0;

  // postImportGetImportedPosts is only supported for the post-import
  // platforms (no GOOGLE_BUSINESS). For analytics platforms outside that
  // overlap we can't fetch a post list, so we just refresh the account
  // and skip post-level metrics — those platforms (GBP) tend not to
  // expose per-post analytics anyway.
  const isImportSupported =
    bundlePlatformSupportsPostImport(args.bundlePlatform);
  if (!isImportSupported) {
    return { refreshed, failures, errors };
  }

  let importedPosts: Array<{
    id: string;
    postId: string | null;
    title: string | null;
    description: string | null;
    permalink: string | null;
    thumbnail: string | null;
    publishedAt: string | null;
  }> = [];

  try {
    const list = await args.client.postImport.postImportGetImportedPosts({
      teamId: args.teamId,
      // SDK type narrows further than analyticsPlatform — cast is safe
      // because the runtime guard above already excluded non-supported
      // platforms.
      socialAccountType:
        args.bundlePlatform as Exclude<typeof args.bundlePlatform, "GOOGLE_BUSINESS">,
      limit: 200,
    });
    importedPosts = list.posts.map((p) => ({
      id: p.id,
      postId: p.postId ?? null,
      title: p.title ?? null,
      description: p.description ?? null,
      permalink: p.permalink ?? null,
      thumbnail: p.thumbnail ?? null,
      publishedAt: p.publishedAt ?? null,
    }));
  } catch (err) {
    errors.push({
      kind: "post_list",
      message: err instanceof Error ? err.message : String(err),
    });
    return { refreshed, failures: failures + 1, errors };
  }

  // Window to the trailing 60 days.
  const cutoff = Date.now() - POST_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const windowed = importedPosts.filter((p) => {
    if (!p.publishedAt) return true; // include unknown dates — better than dropping
    const t = Date.parse(p.publishedAt);
    return Number.isFinite(t) && t >= cutoff;
  });

  if (windowed.length === 0) {
    return { refreshed, failures, errors };
  }

  // Page through bulk analytics 60 at a time.
  for (let i = 0; i < windowed.length; i += BULK_POST_ANALYTICS_PAGE_SIZE) {
    const chunk = windowed.slice(i, i + BULK_POST_ANALYTICS_PAGE_SIZE);
    let analyticsResp;
    try {
      analyticsResp = await args.client.analytics.analyticsGetBulkPostAnalytics({
        platformType: args.bundlePlatform,
        postIds: chunk.map((p) => p.id),
      });
    } catch (err) {
      errors.push({
        kind: "bulk_analytics",
        message: err instanceof Error ? err.message : String(err),
      });
      failures += chunk.length;
      continue;
    }

    const analyticsByPostId = new Map(
      analyticsResp.results.map((r) => [r.postId, r] as const),
    );

    for (const post of chunk) {
      const result = analyticsByPostId.get(post.id);
      const metrics = result?.items?.[0];
      if (!metrics) {
        // bundle.social returned no analytics for this post — skip.
        continue;
      }

      const writeOutcome = await upsertPostSnapshot({
        svc: args.svc,
        profileId: args.profileId,
        internalPlatform: args.internalPlatform,
        bundleSocialAccountId: args.bundleSocialAccountId,
        snapshotDate: args.today,
        postedAt: post.publishedAt,
        post,
        metrics,
      });
      if (writeOutcome.ok) {
        refreshed += 1;
      } else {
        failures += 1;
        errors.push({ kind: "upsert_post", message: writeOutcome.error });
      }
    }
  }

  return { refreshed, failures, errors };
}

function bundlePlatformSupportsPostImport(
  bp: BundleSocialAnalyticsPlatform,
): boolean {
  return bp !== "GOOGLE_BUSINESS";
}

// Idempotent upsert: writes a fresh row OR updates only metric columns
// (preserves title/content/media_urls captured on first insert).
async function upsertPostSnapshot(args: {
  svc: ReturnType<typeof getServiceRoleClient>;
  profileId: string;
  internalPlatform: SocialPlatform;
  bundleSocialAccountId: string;
  snapshotDate: string;
  postedAt: string | null;
  post: {
    id: string;
    title: string | null;
    description: string | null;
    permalink: string | null;
    thumbnail: string | null;
  };
  metrics: {
    impressions: number;
    impressionsUnique: number;
    views: number;
    viewsUnique: number;
    likes: number;
    dislikes: number;
    comments: number;
    shares: number;
    saves: number;
    raw?: unknown;
  };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const existing = await args.svc
    .from("social_post_analytics_snapshots")
    .select("id")
    .eq("profile_id", args.profileId)
    .eq("bundle_post_id", args.post.id)
    .eq("snapshot_date", args.snapshotDate)
    .maybeSingle();

  const metricCols = {
    impressions: args.metrics.impressions ?? null,
    impressions_unique: args.metrics.impressionsUnique ?? null,
    views: args.metrics.views ?? null,
    views_unique: args.metrics.viewsUnique ?? null,
    likes: args.metrics.likes ?? null,
    dislikes: args.metrics.dislikes ?? null,
    comments: args.metrics.comments ?? null,
    shares: args.metrics.shares ?? null,
    saves: args.metrics.saves ?? null,
    raw: args.metrics.raw ?? null,
  };

  if (existing.data?.id) {
    const update = await args.svc
      .from("social_post_analytics_snapshots")
      .update(metricCols)
      .eq("id", existing.data.id);
    if (update.error) return { ok: false, error: update.error.message };
    return { ok: true };
  }

  // First insert — write content fields too.
  const mediaUrls = args.post.thumbnail ? [args.post.thumbnail] : [];
  const insert = await args.svc.from("social_post_analytics_snapshots").insert({
    profile_id: args.profileId,
    bundle_post_id: args.post.id,
    platform: args.internalPlatform,
    bundle_social_account_id: args.bundleSocialAccountId,
    snapshot_date: args.snapshotDate,
    posted_at: args.postedAt,
    post_url: args.post.permalink,
    title: args.post.title,
    content: args.post.description,
    media_urls: mediaUrls.length > 0 ? mediaUrls : null,
    ...metricCols,
  });
  if (insert.error) return { ok: false, error: insert.error.message };
  return { ok: true };
}
