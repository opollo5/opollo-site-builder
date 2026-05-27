import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse, ErrorCode } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// Social analytics data layer.
//
// All queries are scoped to a single company. The caller is responsible
// for canDo("view_calendar", companyId) — same threshold as the posts
// list page.
//
// Design: run all counts / fetches in parallel, aggregate in TypeScript.
// Supabase-js lacks a GROUP BY surface so we fetch minimal projections
// and group here. Capped at 2 000 rows per table for source/state grouping.
//
// V2 dual-lookup (pr-15): each KPI now sums V1 (social_post_master) +
// V2 (social_post_drafts) so the analytics page reflects posts on both
// pipelines during the migration window.
// ---------------------------------------------------------------------------

export type PlatformCount = { platform: string; count: number };
export type SourceCount = { source: string; count: number };
export type StateCount = { state: string; count: number };
export type DayCount = { date: string; count: number };

export type RecentPost = {
  id: string;
  master_text: string | null;
  state_changed_at: string;
  platforms: string[];
};

export type PendingPost = {
  id: string;
  master_text: string | null;
  created_at: string;
};

export type SocialAnalytics = {
  // KPI cards
  totalPublished: number;
  publishedThisMonth: number;
  scheduledUpcoming: number;
  activeConnectionsCount: number;
  // Charts
  postsByPlatform: PlatformCount[];
  postsBySource: SourceCount[];
  postsByState: StateCount[];
  publishedByDay: DayCount[];
  // Lists
  recentPublished: RecentPost[];
  pendingApproval: PendingPost[];
};

const PLATFORM_LABELS: Record<string, string> = {
  linkedin_personal: "LinkedIn (personal)",
  linkedin_company: "LinkedIn (company)",
  linkedin: "LinkedIn",
  facebook_page: "Facebook Page",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  twitter: "X",
  gbp: "Google Business Profile",
  google_business_profile: "Google Business Profile",
  pinterest: "Pinterest",
  tiktok: "TikTok",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  csv: "CSV import",
  cap: "AI generated",
  api: "API",
};

const STATE_LABELS: Record<string, string> = {
  // V1 states
  draft: "Draft",
  pending_client_approval: "Awaiting approval",
  approved: "Approved",
  changes_requested: "Changes requested",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  rejected: "Rejected",
  // V2 states (where different from V1)
  pending_approval: "Awaiting approval",
};

export async function getSocialAnalytics(
  companyId: string,
): Promise<ApiResponse<SocialAnalytics>> {
  if (!companyId) {
    return err("VALIDATION_FAILED", "companyId is required.");
  }

  const svc = getServiceRoleClient();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    // V1 queries
    totalPublishedR,
    publishedThisMonthR,
    scheduledR,
    connectionsR,
    mastersR,
    publishedRecentR,
    pendingR,
    // V2 queries
    v2TotalPublishedR,
    v2PublishedThisMonthR,
    v2ScheduledR,
    v2DraftsR,
    v2PublishedRecentR,
    v2PendingR,
  ] = await Promise.all([
    // V1 KPI: total published all time
    svc
      .from("social_post_master")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "published")
      .is("deleted_at", null),

    // V1 KPI: published this calendar month
    svc
      .from("social_post_master")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "published")
      .gte("state_changed_at", startOfMonth)
      .is("deleted_at", null),

    // V1 KPI: upcoming scheduled
    svc
      .from("social_post_master")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "scheduled")
      .is("deleted_at", null),

    // KPI: active (healthy) connections — shared by V1 + V2
    svc
      .from("social_connections")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "healthy")
      .is("deleted_at", null),

    // V1 chart source: all posts (source_type + state) capped at 2 000
    svc
      .from("social_post_master")
      .select("id, source_type, state")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .limit(2000),

    // V1 trend: published in the last 30 days
    svc
      .from("social_post_master")
      .select("id, state_changed_at")
      .eq("company_id", companyId)
      .eq("state", "published")
      .gte("state_changed_at", thirtyDaysAgo)
      .is("deleted_at", null)
      .order("state_changed_at", { ascending: true }),

    // V1 list: pending approval (most recently created first)
    svc
      .from("social_post_master")
      .select("id, master_text, created_at")
      .eq("company_id", companyId)
      .eq("state", "pending_client_approval")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),

    // V2 KPI: total published all time
    svc
      .from("social_post_drafts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "published"),

    // V2 KPI: published this calendar month (uses published_at, not state_changed_at)
    svc
      .from("social_post_drafts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "published")
      .gte("published_at", startOfMonth),

    // V2 KPI: upcoming scheduled (state=scheduled, not by scheduled_at since that's the time)
    svc
      .from("social_post_drafts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "scheduled"),

    // V2 chart source: all drafts for state/source/platform aggregation (cap 2 000)
    svc
      .from("social_post_drafts")
      .select("id, state, source_type, target_profiles, published_at")
      .eq("company_id", companyId)
      .limit(2000),

    // V2 trend: published in the last 30 days (published_at)
    svc
      .from("social_post_drafts")
      .select("id, published_at")
      .eq("company_id", companyId)
      .eq("state", "published")
      .gte("published_at", thirtyDaysAgo)
      .order("published_at", { ascending: true }),

    // V2 list: pending approval
    svc
      .from("social_post_drafts")
      .select("id, content, created_at")
      .eq("company_id", companyId)
      .eq("state", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Surface the first V1 query error.
  const queryError =
    totalPublishedR.error ??
    publishedThisMonthR.error ??
    scheduledR.error ??
    connectionsR.error ??
    mastersR.error ??
    publishedRecentR.error ??
    pendingR.error;

  if (queryError) {
    logger.error("social.analytics.query_failed", {
      err: queryError.message,
      company_id: companyId,
    });
    return err("INTERNAL_ERROR", `Analytics query failed: ${queryError.message}`);
  }

  // V2 query errors are non-fatal — log and continue with V1-only data.
  const v2Error =
    v2TotalPublishedR.error ??
    v2PublishedThisMonthR.error ??
    v2ScheduledR.error ??
    v2DraftsR.error ??
    v2PublishedRecentR.error ??
    v2PendingR.error;
  if (v2Error) {
    logger.warn("social.analytics.v2_query_failed", {
      err: v2Error.message,
      company_id: companyId,
    });
  }

  // --- KPIs: V1 + V2 ---
  const totalPublished = (totalPublishedR.count ?? 0) + (v2TotalPublishedR.count ?? 0);
  const publishedThisMonth = (publishedThisMonthR.count ?? 0) + (v2PublishedThisMonthR.count ?? 0);
  const scheduledUpcoming = (scheduledR.count ?? 0) + (v2ScheduledR.count ?? 0);

  // --- Charts ---

  const masters = mastersR.data ?? [];
  const masterIds = masters.map((m) => m.id as string);
  const v2Drafts = v2Error ? [] : (v2DraftsR.data ?? []);

  // V1 variants (for platform aggregation)
  let variants: Array<{ post_master_id: string; platform: string }> = [];
  if (masterIds.length > 0) {
    const variantsR = await svc
      .from("social_post_variant")
      .select("post_master_id, platform")
      .in("post_master_id", masterIds)
      .is("deleted_at", null);
    if (variantsR.error) {
      logger.error("social.analytics.variants_failed", {
        err: variantsR.error.message,
        company_id: companyId,
      });
    } else {
      variants = (variantsR.data ?? []) as typeof variants;
    }
  }

  // postsByPlatform: V1 via variants + V2 via target_profiles expansion
  const platformMap = new Map<string, Set<string>>();
  for (const v of variants) {
    const pid = v.post_master_id as string;
    const plat = v.platform as string;
    if (!platformMap.has(plat)) platformMap.set(plat, new Set());
    platformMap.get(plat)!.add(pid);
  }
  for (const d of v2Drafts) {
    const profiles =
      (d.target_profiles as Array<{ profile_id: string; platform: string }> | null) ?? [];
    const seenPlats = new Set<string>();
    for (const p of profiles) {
      if (!seenPlats.has(p.platform)) {
        seenPlats.add(p.platform);
        if (!platformMap.has(p.platform)) platformMap.set(p.platform, new Set());
        platformMap.get(p.platform)!.add(d.id as string);
      }
    }
  }
  const postsByPlatform: PlatformCount[] = Array.from(platformMap.entries())
    .map(([platform, ids]) => ({
      platform: PLATFORM_LABELS[platform] ?? platform,
      count: ids.size,
    }))
    .sort((a, b) => b.count - a.count);

  // postsBySource: V1 + V2
  const sourceMap = new Map<string, number>();
  for (const m of masters) {
    const src = (m.source_type as string) ?? "manual";
    sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
  }
  for (const d of v2Drafts) {
    const src = (d.source_type as string | null) ?? "manual";
    sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
  }
  const postsBySource: SourceCount[] = Array.from(sourceMap.entries())
    .map(([source, count]) => ({
      source: SOURCE_LABELS[source] ?? source,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // postsByState: V1 + V2
  const stateMap = new Map<string, number>();
  for (const m of masters) {
    const st = (m.state as string) ?? "draft";
    stateMap.set(st, (stateMap.get(st) ?? 0) + 1);
  }
  for (const d of v2Drafts) {
    const st = (d.state as string) ?? "draft";
    stateMap.set(st, (stateMap.get(st) ?? 0) + 1);
  }
  const postsByState: StateCount[] = Array.from(stateMap.entries())
    .map(([state, count]) => ({
      state: STATE_LABELS[state] ?? state,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // publishedByDay: V1 (state_changed_at) + V2 (published_at)
  const dayMap = new Map<string, number>();
  for (const p of publishedRecentR.data ?? []) {
    const day = (p.state_changed_at as string).slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  if (!v2Error) {
    for (const d of v2PublishedRecentR.data ?? []) {
      const pubAt = d.published_at as string | null;
      if (pubAt) {
        const day = pubAt.slice(0, 10);
        dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
      }
    }
  }
  const publishedByDay: DayCount[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    publishedByDay.push({ date: dateStr, count: dayMap.get(dateStr) ?? 0 });
  }

  // recentPublished: V1 + V2 merged and sorted by most recent
  const recentPublished = await buildRecentPublished(svc, companyId, !!v2Error);

  // pendingApproval: V1 + V2 merged, sorted by created_at desc, capped at 20
  const v1Pending = (pendingR.data ?? []).map((p) => ({
    id: p.id as string,
    master_text: (p.master_text as string | null) ?? null,
    created_at: p.created_at as string,
  }));
  const v2Pending = v2Error
    ? []
    : (v2PendingR.data ?? []).map((d) => ({
        id: d.id as string,
        master_text: (d.content as string | null) ?? null,
        created_at: d.created_at as string,
      }));
  const pendingApproval = [...v1Pending, ...v2Pending]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20);

  return {
    ok: true,
    data: {
      totalPublished,
      publishedThisMonth,
      scheduledUpcoming,
      activeConnectionsCount: connectionsR.count ?? 0,
      postsByPlatform,
      postsBySource,
      postsByState,
      publishedByDay,
      recentPublished,
      pendingApproval,
    },
    timestamp: new Date().toISOString(),
  };
}

async function buildRecentPublished(
  svc: ReturnType<typeof getServiceRoleClient>,
  companyId: string,
  skipV2: boolean,
): Promise<RecentPost[]> {
  // V1 recent published
  const postsR = await svc
    .from("social_post_master")
    .select("id, master_text, state_changed_at")
    .eq("company_id", companyId)
    .eq("state", "published")
    .is("deleted_at", null)
    .order("state_changed_at", { ascending: false })
    .limit(10);

  const v1Posts: RecentPost[] = [];
  if (!postsR.error && postsR.data && postsR.data.length > 0) {
    const ids = postsR.data.map((p) => p.id as string);
    const variantsR = await svc
      .from("social_post_variant")
      .select("post_master_id, platform")
      .in("post_master_id", ids)
      .is("deleted_at", null);

    const platformsByPost = new Map<string, string[]>();
    for (const v of variantsR.data ?? []) {
      const pid = v.post_master_id as string;
      const plat = v.platform as string;
      if (!platformsByPost.has(pid)) platformsByPost.set(pid, []);
      platformsByPost.get(pid)!.push(PLATFORM_LABELS[plat] ?? plat);
    }

    for (const p of postsR.data) {
      v1Posts.push({
        id: p.id as string,
        master_text: (p.master_text as string | null) ?? null,
        state_changed_at: p.state_changed_at as string,
        platforms: platformsByPost.get(p.id as string) ?? [],
      });
    }
  }

  // V2 recent published
  const v2Posts: RecentPost[] = [];
  if (!skipV2) {
    const v2R = await svc
      .from("social_post_drafts")
      .select("id, content, published_at, target_profiles")
      .eq("company_id", companyId)
      .eq("state", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(10);

    if (!v2R.error) {
      for (const d of v2R.data ?? []) {
        const profiles =
          (d.target_profiles as Array<{ profile_id: string; platform: string }> | null) ?? [];
        v2Posts.push({
          id: d.id as string,
          master_text: (d.content as string | null) ?? null,
          state_changed_at: (d.published_at as string) ?? new Date().toISOString(),
          platforms: [...new Set(profiles.map((p) => PLATFORM_LABELS[p.platform] ?? p.platform))],
        });
      }
    }
  }

  // Merge V1 + V2, sort by state_changed_at desc, take top 10
  return [...v1Posts, ...v2Posts]
    .sort((a, b) => b.state_changed_at.localeCompare(a.state_changed_at))
    .slice(0, 10);
}

function err(
  code: ErrorCode,
  message: string,
): ApiResponse<SocialAnalytics> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
