import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

import type {
  PostHistoryImport,
  PostHistoryImportStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Dashboard read layer — pure read functions over the snapshot tables.
//
// All functions are scoped to a profileId. The caller is responsible
// for auth (canDo("view_analytics", companyId) or staff gate).
//
// Date ranges: window the snapshots by snapshot_date. Aggregates are
// computed in TypeScript because Supabase-js doesn't have GROUP BY
// surface. With a 90-day window at ~5 platforms = ~450 rows per profile
// — comfortable.
// ---------------------------------------------------------------------------

export type AnalyticsDateRange = 7 | 30 | 90;

export type AnalyticsPlatformSummary = {
  platform: SocialPlatform;
  // Latest snapshot in the window — the "current" values shown in the
  // stat cards. Nullable for platforms without analytics support (X).
  current: {
    followers: number | null;
    post_count: number | null;
    impressions_period: number; // summed across all days in window
    engagement_rate_period: number | null;
  };
  previous: {
    impressions_period: number;
  };
  // Delta vs previous equivalent-length period. null if previous is 0.
  impressions_delta_pct: number | null;
  has_data: boolean;
};

export type AnalyticsTimeSeriesPoint = {
  date: string; // YYYY-MM-DD
  // platform → impressions on that day
  by_platform: Record<string, number>;
  total: number;
};

export type AnalyticsTopPost = {
  bundle_post_id: string;
  platform: SocialPlatform;
  posted_at: string | null;
  post_url: string | null;
  title: string | null;
  content_snippet: string | null;
  thumbnail_url: string | null;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  engagement_rate: number | null;
};

export type AnalyticsDashboard = {
  profile_id: string;
  range_days: AnalyticsDateRange;
  total_impressions_period: number;
  total_impressions_previous_period: number;
  total_impressions_delta_pct: number | null;
  platforms: AnalyticsPlatformSummary[];
  time_series: AnalyticsTimeSeriesPoint[];
  top_posts: AnalyticsTopPost[];
  active_imports: PostHistoryImport[];
  // True when no snapshots exist at all → render first-time empty state.
  is_first_time: boolean;
};

export async function getProfileAnalyticsDashboard(input: {
  profileId: string;
  rangeDays: AnalyticsDateRange;
}): Promise<AnalyticsDashboard> {
  const svc = getServiceRoleClient();
  const today = new Date();
  const rangeMs = input.rangeDays * 24 * 60 * 60 * 1000;
  const periodStart = new Date(today.getTime() - rangeMs);
  const previousStart = new Date(today.getTime() - 2 * rangeMs);
  const periodStartIso = periodStart.toISOString().slice(0, 10);
  const previousStartIso = previousStart.toISOString().slice(0, 10);

  const [
    profileSnapshotsCurrentR,
    profileSnapshotsPreviousR,
    topPostsR,
    importsR,
    anyPostCountR,
  ] = await Promise.all([
    svc
      .from("social_profile_analytics_snapshots")
      .select(
        "platform, bundle_social_account_id, snapshot_date, followers, post_count, impressions, likes, comments",
      )
      .eq("profile_id", input.profileId)
      .gte("snapshot_date", periodStartIso)
      .order("snapshot_date", { ascending: true }),
    svc
      .from("social_profile_analytics_snapshots")
      .select("platform, snapshot_date, impressions")
      .eq("profile_id", input.profileId)
      .gte("snapshot_date", previousStartIso)
      .lt("snapshot_date", periodStartIso),
    svc
      .from("social_post_analytics_snapshots")
      .select(
        "bundle_post_id, platform, posted_at, post_url, title, content, media_urls, impressions, likes, comments, shares, engagement_rate, snapshot_date",
      )
      .eq("profile_id", input.profileId)
      .gte("snapshot_date", periodStartIso)
      .order("engagement_rate", { ascending: false, nullsFirst: false })
      .limit(50),
    svc
      .from("social_post_history_imports")
      .select(
        "id, profile_id, bundle_social_account_id, platform, status, bundle_import_id, started_at, completed_at, posts_imported, error_message, created_at, updated_at",
      )
      .eq("profile_id", input.profileId)
      .order("created_at", { ascending: false })
      .limit(20),
    svc
      .from("social_post_analytics_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", input.profileId),
  ]);

  const profileSnapshots = (profileSnapshotsCurrentR.data ?? []) as Array<{
    platform: SocialPlatform;
    bundle_social_account_id: string;
    snapshot_date: string;
    followers: number | null;
    post_count: number | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
  }>;
  const previousSnapshots = (profileSnapshotsPreviousR.data ?? []) as Array<{
    platform: SocialPlatform;
    snapshot_date: string;
    impressions: number | null;
  }>;
  const topPostRows = (topPostsR.data ?? []) as Array<{
    bundle_post_id: string;
    platform: SocialPlatform;
    posted_at: string | null;
    post_url: string | null;
    title: string | null;
    content: string | null;
    media_urls: string[] | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    engagement_rate: number | null;
    snapshot_date: string;
  }>;

  // Per-platform summary: latest snapshot for "current" values, summed
  // impressions for the period delta.
  const platformsMap = new Map<SocialPlatform, AnalyticsPlatformSummary>();
  for (const s of profileSnapshots) {
    const existing = platformsMap.get(s.platform);
    if (!existing) {
      platformsMap.set(s.platform, {
        platform: s.platform,
        current: {
          followers: s.followers,
          post_count: s.post_count,
          impressions_period: s.impressions ?? 0,
          engagement_rate_period: null,
        },
        previous: { impressions_period: 0 },
        impressions_delta_pct: null,
        has_data: true,
      });
    } else {
      // snapshots are ordered ascending — last value seen wins for the
      // point-in-time fields.
      existing.current.followers = s.followers ?? existing.current.followers;
      existing.current.post_count = s.post_count ?? existing.current.post_count;
      existing.current.impressions_period += s.impressions ?? 0;
    }
  }
  for (const s of previousSnapshots) {
    const existing = platformsMap.get(s.platform);
    if (existing) {
      existing.previous.impressions_period += s.impressions ?? 0;
    }
  }
  for (const summary of platformsMap.values()) {
    const prev = summary.previous.impressions_period;
    if (prev > 0) {
      summary.impressions_delta_pct =
        ((summary.current.impressions_period - prev) / prev) * 100;
    }
  }

  // Time series: per-day per-platform impressions across the window.
  const dayMap = new Map<string, Map<SocialPlatform, number>>();
  for (const s of profileSnapshots) {
    const day = s.snapshot_date;
    if (!dayMap.has(day)) dayMap.set(day, new Map());
    const inner = dayMap.get(day)!;
    inner.set(s.platform, (inner.get(s.platform) ?? 0) + (s.impressions ?? 0));
  }

  // Fill every day in the window — zero values for days without snapshots.
  const series: AnalyticsTimeSeriesPoint[] = [];
  for (let i = input.rangeDays - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const inner = dayMap.get(dateStr);
    const by_platform: Record<string, number> = {};
    let total = 0;
    if (inner) {
      for (const [platform, value] of inner.entries()) {
        by_platform[platform] = value;
        total += value;
      }
    }
    series.push({ date: dateStr, by_platform, total });
  }

  // Top posts: dedupe by bundle_post_id (most recent snapshot wins),
  // sort by engagement_rate desc, tie-break by impressions desc, top 10.
  const byBundleId = new Map<string, (typeof topPostRows)[number]>();
  for (const row of topPostRows) {
    const existing = byBundleId.get(row.bundle_post_id);
    if (!existing || row.snapshot_date > existing.snapshot_date) {
      byBundleId.set(row.bundle_post_id, row);
    }
  }
  const topPosts: AnalyticsTopPost[] = Array.from(byBundleId.values())
    .sort((a, b) => {
      const ra = a.engagement_rate ?? -1;
      const rb = b.engagement_rate ?? -1;
      if (rb !== ra) return rb - ra;
      return (b.impressions ?? 0) - (a.impressions ?? 0);
    })
    .slice(0, 10)
    .map((row) => ({
      bundle_post_id: row.bundle_post_id,
      platform: row.platform,
      posted_at: row.posted_at,
      post_url: row.post_url,
      title: row.title,
      content_snippet: row.content ? row.content.slice(0, 120) : null,
      thumbnail_url: row.media_urls?.[0] ?? null,
      impressions: row.impressions ?? 0,
      likes: row.likes ?? 0,
      comments: row.comments ?? 0,
      shares: row.shares ?? 0,
      engagement_rate: row.engagement_rate,
    }));

  // Totals across all platforms.
  let totalCurrent = 0;
  let totalPrevious = 0;
  for (const summary of platformsMap.values()) {
    totalCurrent += summary.current.impressions_period;
    totalPrevious += summary.previous.impressions_period;
  }
  const totalDeltaPct =
    totalPrevious > 0
      ? ((totalCurrent - totalPrevious) / totalPrevious) * 100
      : null;

  // Order platforms by current-period impressions DESC, alpha tie-break.
  const platforms = Array.from(platformsMap.values()).sort((a, b) => {
    const ic = b.current.impressions_period - a.current.impressions_period;
    if (ic !== 0) return ic;
    return a.platform.localeCompare(b.platform);
  });

  const activeImports = ((importsR.data ?? []) as PostHistoryImport[]).filter(
    (i) => isActiveStatus(i.status),
  );

  const totalPostSnapshots = anyPostCountR.count ?? 0;
  const isFirstTime =
    profileSnapshots.length === 0 && totalPostSnapshots === 0;

  return {
    profile_id: input.profileId,
    range_days: input.rangeDays,
    total_impressions_period: totalCurrent,
    total_impressions_previous_period: totalPrevious,
    total_impressions_delta_pct: totalDeltaPct,
    platforms,
    time_series: series,
    top_posts: topPosts,
    active_imports: activeImports,
    is_first_time: isFirstTime,
  };
}

function isActiveStatus(s: PostHistoryImportStatus): boolean {
  return s === "queued" || s === "running";
}
