import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Company-level Insights dashboard data layer.
//
// All queries are scoped to companyId. Fetches in parallel where possible.
// Aggregates engagement_rate using the STORED generated column in
// social_post_analytics_snapshots (formula: (likes+comments+shares)/impressions).
//
// RLS note: company users can read social_post_analytics_snapshots and
// ins_post_features via is_company_member() policy. We use service role
// here because this runs server-side after auth has been verified.
// ---------------------------------------------------------------------------

export interface InsightsDashboardData {
  companyId: string;
  dataFreshness: {
    lastIngestIso: string | null;
    isStale: boolean;
  };
  kpis: {
    reach30d: number | null;
    avgEngagementRate30d: number | null;
    followerGrowth30d: number | null;
    bestPost: { id: string; engagementRate: number; url: string | null } | null;
  } | null;
  availableMetrics: {
    likes: boolean;
    comments: boolean;
    shares: boolean;
    impressions: boolean;
    reach: boolean;
  };
  activePlatform: string;
  platforms: Array<{
    platform: string;
    postCount30d: number;
    connected: boolean;
    lastIngestRelative: string;
    healthStatus: "green" | "amber" | "red";
  }>;
  trendByPlatform: Record<string, Array<{ date: string; engagementRate: number }>>;
  bestPosts: BestPost[];
  underperformingPosts: BestPost[];
  heatmapData: Array<{
    dayOfWeek: number;
    hour: number;
    engagementRate: number;
    postCount: number;
  }> | null;
  sourceComparison: {
    cap: { count: number; avgEngagementRate: number };
    composer: { count: number; avgEngagementRate: number };
  } | null;
  xConnected: boolean;
  xMetrics: { published30d: number; scheduled: number } | null;
  postCount90d: number;
}

export interface BestPost {
  id: string;
  bundlePostId: string;
  platform: string;
  source: "cap" | "composer";
  content: string;
  postedAt: string;
  engagementRate: number;
  impressions: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export async function getInsightsDashboardData(
  companyId: string,
): Promise<InsightsDashboardData> {
  const svc = getServiceRoleClient();

  const now = new Date();
  const ago30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ago90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const ago48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const ago30str = ago30.toISOString().slice(0, 10);
  const ago90str = ago90.toISOString().slice(0, 10);

  // Step 1: get profile IDs for this company
  const { data: profiles } = await svc
    .from("platform_social_profiles")
    .select("id")
    .eq("company_id", companyId);

  const profileIds: string[] = (profiles ?? []).map((p: { id: string }) => p.id);

  if (profileIds.length === 0) {
    return emptyDashboard(companyId);
  }

  // Step 2: parallel queries
  const [
    snapshotsR,
    snapshots30dR,
    heatmapR,
    connectionsR,
    postMasterR,
    ingestLogR,
  ] = await Promise.all([
    // All snapshots last 90 days for trend + best posts
    svc
      .from("social_post_analytics_snapshots")
      .select(
        "id, bundle_post_id, profile_id, platform, posted_at, content, impressions, likes, comments, shares, engagement_rate, snapshot_date",
      )
      .in("profile_id", profileIds)
      .gte("snapshot_date", ago90str)
      .gte("impressions", 50)
      .order("snapshot_date", { ascending: false }),

    // Latest snapshot per post for 30d KPIs
    svc
      .from("social_post_analytics_snapshots")
      .select("bundle_post_id, platform, impressions, engagement_rate, likes, comments, shares")
      .in("profile_id", profileIds)
      .gte("snapshot_date", ago30str),

    // Heatmap: ins_post_features for day/hour distribution
    svc
      .from("ins_post_features")
      .select("day_of_week, hour_of_day_utc, platform")
      .eq("company_id", companyId)
      .gte("posted_at", ago90.toISOString()),

    // Connection health
    svc
      .from("social_connections")
      .select("id, platform, status, updated_at")
      .eq("company_id", companyId)
      .is("deleted_at", null),

    // X post counts
    svc
      .from("social_post_master")
      .select("id, state, source_type, created_at")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .in("state", ["published", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(2000),

    // Last ingest timestamp
    svc
      .from("ins_ingest_log")
      .select("completed_at, status")
      .eq("company_id", companyId)
      .eq("status", "success")
      .order("completed_at", { ascending: false })
      .limit(1),
  ]);

  const snapshots = snapshotsR.data ?? [];
  const snapshots30d = snapshots30dR.data ?? [];
  const heatmapRows = heatmapR.data ?? [];
  const connections = connectionsR.data ?? [];
  const postMasters = postMasterR.data ?? [];

  // Data freshness
  const lastIngest = ingestLogR.data?.[0];
  const lastIngestIso = lastIngest?.completed_at ?? null;
  const isStale = lastIngestIso
    ? new Date(lastIngestIso) < ago48h
    : true;

  // postCount90d: unique bundle_post_ids with a snapshot
  const postCount90d = new Set(snapshots.map((s: { bundle_post_id: string }) => s.bundle_post_id)).size;

  // availableMetrics: check if columns are non-null in any snapshot
  const hasLikes = snapshots30d.some((s: { likes: number | null }) => s.likes !== null);
  const hasComments = snapshots30d.some((s: { comments: number | null }) => s.comments !== null);
  const hasShares = snapshots30d.some((s: { shares: number | null }) => s.shares !== null);
  const hasImpressions = snapshots30d.some((s: { impressions: number | null }) => (s.impressions ?? 0) > 0);
  const availableMetrics = {
    likes: hasLikes,
    comments: hasComments,
    shares: hasShares,
    impressions: hasImpressions,
    reach: hasImpressions,
  };

  // KPIs
  let kpis: InsightsDashboardData["kpis"] = null;
  if (snapshots30d.length > 0) {
    const totalReach = snapshots30d.reduce(
      (sum: number, s: { impressions: number | null }) => sum + (s.impressions ?? 0),
      0,
    );
    const withEngagement = snapshots30d.filter(
      (s: { engagement_rate: number | null }) => s.engagement_rate !== null,
    );
    const avgEngRate =
      withEngagement.length > 0
        ? withEngagement.reduce(
            (sum: number, s: { engagement_rate: number | null }) => sum + Number(s.engagement_rate ?? 0),
            0,
          ) / withEngagement.length
        : null;

    // Best post: highest engagement_rate in 30d with impressions >= 50
    const bestSnap = snapshots
      .filter(
        (s: { snapshot_date: string; engagement_rate: number | null }) =>
          s.snapshot_date >= ago30str && s.engagement_rate !== null,
      )
      .sort(
        (a: { engagement_rate: number | null }, b: { engagement_rate: number | null }) =>
          Number(b.engagement_rate ?? 0) - Number(a.engagement_rate ?? 0),
      )[0];

    kpis = {
      reach30d: totalReach,
      avgEngagementRate30d: avgEngRate,
      followerGrowth30d: null, // followers come from profile snapshots; skip for V1
      bestPost: bestSnap
        ? {
            id: bestSnap.id,
            engagementRate: Number(bestSnap.engagement_rate),
            url: null,
          }
        : null,
    };
  }

  // Best posts (top 10 by engagement_rate)
  const dedupedByBundlePost = dedupeByBundlePost(snapshots);
  const bestPosts: BestPost[] = dedupedByBundlePost
    .filter(
      (s: SnapshotRow) => s.engagement_rate !== null && Number(s.engagement_rate) > 0,
    )
    .sort(
      (a: SnapshotRow, b: SnapshotRow) =>
        Number(b.engagement_rate ?? 0) - Number(a.engagement_rate ?? 0),
    )
    .slice(0, 10)
    .map((s: SnapshotRow) => snapshotToPost(s, "composer"));

  // Underperforming posts (bottom 10 by engagement_rate)
  const underperformingPosts: BestPost[] = dedupedByBundlePost
    .filter(
      (s: SnapshotRow) => s.engagement_rate !== null && Number(s.engagement_rate) >= 0,
    )
    .sort(
      (a: SnapshotRow, b: SnapshotRow) =>
        Number(a.engagement_rate ?? 0) - Number(b.engagement_rate ?? 0),
    )
    .slice(0, 10)
    .map((s: SnapshotRow) => snapshotToPost(s, "composer"));

  // Trend by platform (last 90 days)
  const trendByPlatform: Record<string, Array<{ date: string; engagementRate: number }>> = {};
  for (const s of snapshots) {
    if (!trendByPlatform[s.platform]) trendByPlatform[s.platform] = [];
    trendByPlatform[s.platform].push({
      date: s.snapshot_date,
      engagementRate: Number(s.engagement_rate ?? 0),
    });
  }
  // Sort each platform's trend ascending by date
  for (const platform of Object.keys(trendByPlatform)) {
    trendByPlatform[platform].sort((a, b) => a.date.localeCompare(b.date));
  }

  // Active platform (most post activity in 30d)
  const platformPostCounts: Record<string, number> = {};
  for (const s of snapshots) {
    if (s.snapshot_date >= ago30str) {
      platformPostCounts[s.platform] = (platformPostCounts[s.platform] ?? 0) + 1;
    }
  }
  const activePlatform =
    Object.entries(platformPostCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ??
    "linkedin_company";

  // Platform stats
  const platformStats: InsightsDashboardData["platforms"] = [];
  const seenPlatforms = new Set<string>();
  for (const conn of connections) {
    const platform = conn.platform as string;
    if (seenPlatforms.has(platform)) continue;
    seenPlatforms.add(platform);
    const postCount = snapshots.filter(
      (s: { platform: string; snapshot_date: string }) =>
        s.platform === platform && s.snapshot_date >= ago30str,
    ).length;
    const lastUpdated = conn.updated_at ? new Date(conn.updated_at as string) : null;
    const diffH = lastUpdated
      ? Math.round((now.getTime() - lastUpdated.getTime()) / 3600000)
      : null;
    platformStats.push({
      platform,
      postCount30d: postCount,
      connected: conn.status === "healthy",
      lastIngestRelative: diffH !== null ? `${diffH}h ago` : "Unknown",
      healthStatus:
        conn.status === "healthy" ? "green" : conn.status === "needs_reconnect" ? "red" : "amber",
    });
  }

  // Heatmap: aggregate by dayOfWeek + hour
  const heatmapAgg: Record<string, { total: number; count: number }> = {};
  for (const row of heatmapRows) {
    const key = `${row.day_of_week}:${row.hour_of_day_utc}`;
    if (!heatmapAgg[key]) heatmapAgg[key] = { total: 0, count: 0 };
    heatmapAgg[key].count += 1;
  }
  const heatmapData =
    Object.keys(heatmapAgg).length > 0
      ? Object.entries(heatmapAgg).map(([key, val]) => {
          const [dayStr, hourStr] = key.split(":");
          return {
            dayOfWeek: parseInt(dayStr, 10),
            hour: parseInt(hourStr, 10),
            engagementRate: 0, // heatmap shows posting frequency only at this stage
            postCount: val.count,
          };
        })
      : null;

  // Source comparison
  const insFeatures = (heatmapR.data ?? []) as Array<{ day_of_week: number; hour_of_day_utc: number; platform: string }>;
  const sourceComparison =
    insFeatures.length > 0
      ? {
          cap: { count: 0, avgEngagementRate: 0 },
          composer: { count: 0, avgEngagementRate: 0 },
        }
      : null;

  // X: connected + metrics
  const xConnection = connections.find((c: { platform: string }) => c.platform === "x");
  const xConnected = !!xConnection;
  const xPublished30d = postMasters.filter(
    (p: { state: string }) => p.state === "published",
  ).length;
  const xScheduled = postMasters.filter(
    (p: { state: string }) => p.state === "scheduled",
  ).length;
  const xMetrics = xConnected
    ? { published30d: xPublished30d, scheduled: xScheduled }
    : null;

  return {
    companyId,
    dataFreshness: { lastIngestIso, isStale },
    kpis,
    availableMetrics,
    activePlatform,
    platforms: platformStats,
    trendByPlatform,
    bestPosts,
    underperformingPosts,
    heatmapData,
    sourceComparison,
    xConnected,
    xMetrics,
    postCount90d,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SnapshotRow = {
  id: string;
  bundle_post_id: string;
  profile_id: string;
  platform: string;
  posted_at: string | null;
  content: string | null;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagement_rate: number | null;
  snapshot_date: string;
};

function dedupeByBundlePost(snapshots: SnapshotRow[]): SnapshotRow[] {
  // Keep the most recent snapshot per bundle_post_id
  const map = new Map<string, SnapshotRow>();
  for (const s of snapshots) {
    const existing = map.get(s.bundle_post_id);
    if (!existing || s.snapshot_date > existing.snapshot_date) {
      map.set(s.bundle_post_id, s);
    }
  }
  return Array.from(map.values());
}

function snapshotToPost(s: SnapshotRow, source: "cap" | "composer"): BestPost {
  return {
    id: s.id,
    bundlePostId: s.bundle_post_id,
    platform: s.platform,
    source,
    content: s.content ?? "",
    postedAt: s.posted_at ?? s.snapshot_date,
    engagementRate: Number(s.engagement_rate ?? 0),
    impressions: s.impressions ?? 0,
    likes: s.likes,
    comments: s.comments,
    shares: s.shares,
  };
}

function emptyDashboard(companyId: string): InsightsDashboardData {
  return {
    companyId,
    dataFreshness: { lastIngestIso: null, isStale: false },
    kpis: null,
    availableMetrics: {
      likes: false,
      comments: false,
      shares: false,
      impressions: false,
      reach: false,
    },
    activePlatform: "linkedin_company",
    platforms: [],
    trendByPlatform: {},
    bestPosts: [],
    underperformingPosts: [],
    heatmapData: null,
    sourceComparison: null,
    xConnected: false,
    xMetrics: null,
    postCount90d: 0,
  };
}
