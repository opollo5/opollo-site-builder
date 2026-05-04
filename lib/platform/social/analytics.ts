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
// and group here. Capped at 2 000 post-master rows for source/state
// grouping — sufficient for a social media calendar workload.
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
  facebook_page: "Facebook Page",
  x: "X",
  gbp: "Google Business Profile",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  csv: "CSV import",
  cap: "AI generated",
  api: "API",
};

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_client_approval: "Awaiting approval",
  approved: "Approved",
  changes_requested: "Changes requested",
  pending_msp_release: "Awaiting MSP release",
  scheduled: "Scheduled",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
  rejected: "Rejected",
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
    totalPublishedR,
    publishedThisMonthR,
    scheduledR,
    connectionsR,
    mastersR,
    publishedRecentR,
    pendingR,
  ] = await Promise.all([
    // KPI: total published all time
    svc
      .from("social_post_master")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "published")
      .is("deleted_at", null),

    // KPI: published this calendar month
    svc
      .from("social_post_master")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "published")
      .gte("state_changed_at", startOfMonth)
      .is("deleted_at", null),

    // KPI: upcoming scheduled
    svc
      .from("social_post_master")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("state", "scheduled")
      .is("deleted_at", null),

    // KPI: active (healthy) connections
    svc
      .from("social_connections")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "healthy")
      .is("deleted_at", null),

    // Chart source: all posts (source_type + state) capped at 2 000
    svc
      .from("social_post_master")
      .select("id, source_type, state")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .limit(2000),

    // Trend: published in the last 30 days — small dataset
    svc
      .from("social_post_master")
      .select("id, state_changed_at")
      .eq("company_id", companyId)
      .eq("state", "published")
      .gte("state_changed_at", thirtyDaysAgo)
      .is("deleted_at", null)
      .order("state_changed_at", { ascending: true }),

    // List: pending approval (most recently created first)
    svc
      .from("social_post_master")
      .select("id, master_text, created_at")
      .eq("company_id", companyId)
      .eq("state", "pending_client_approval")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  // Surface the first query error we encounter.
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

  const masters = mastersR.data ?? [];
  const masterIds = masters.map((m) => m.id as string);

  // Fetch variants (platforms) for all posts so we can aggregate by platform.
  // Uses the same 2 000-post cap (same IDs).
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
      // Non-fatal: continue with empty platform data.
    } else {
      variants = (variantsR.data ?? []) as typeof variants;
    }
  }

  // Fetch recent published posts with their platforms.
  const recentPublished = await buildRecentPublished(svc, companyId);

  // --- Aggregations ---

  // postsByPlatform: unique post_master_id per platform
  const platformMap = new Map<string, Set<string>>();
  for (const v of variants) {
    const pid = v.post_master_id as string;
    const plat = v.platform as string;
    if (!platformMap.has(plat)) platformMap.set(plat, new Set());
    platformMap.get(plat)!.add(pid);
  }
  const postsByPlatform: PlatformCount[] = Array.from(platformMap.entries())
    .map(([platform, ids]) => ({
      platform: PLATFORM_LABELS[platform] ?? platform,
      count: ids.size,
    }))
    .sort((a, b) => b.count - a.count);

  // postsBySource
  const sourceMap = new Map<string, number>();
  for (const m of masters) {
    const src = (m.source_type as string) ?? "manual";
    sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
  }
  const postsBySource: SourceCount[] = Array.from(sourceMap.entries())
    .map(([source, count]) => ({
      source: SOURCE_LABELS[source] ?? source,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // postsByState
  const stateMap = new Map<string, number>();
  for (const m of masters) {
    const st = (m.state as string) ?? "draft";
    stateMap.set(st, (stateMap.get(st) ?? 0) + 1);
  }
  const postsByState: StateCount[] = Array.from(stateMap.entries())
    .map(([state, count]) => ({
      state: STATE_LABELS[state] ?? state,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // publishedByDay: 30-day trend
  const dayMap = new Map<string, number>();
  for (const p of publishedRecentR.data ?? []) {
    const day = (p.state_changed_at as string).slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }
  // Fill in all 30 days, even those with zero posts.
  const publishedByDay: DayCount[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    publishedByDay.push({ date: dateStr, count: dayMap.get(dateStr) ?? 0 });
  }

  return {
    ok: true,
    data: {
      totalPublished: totalPublishedR.count ?? 0,
      publishedThisMonth: publishedThisMonthR.count ?? 0,
      scheduledUpcoming: scheduledR.count ?? 0,
      activeConnectionsCount: connectionsR.count ?? 0,
      postsByPlatform,
      postsBySource,
      postsByState,
      publishedByDay,
      recentPublished,
      pendingApproval: (pendingR.data ?? []).map((p) => ({
        id: p.id as string,
        master_text: (p.master_text as string | null) ?? null,
        created_at: p.created_at as string,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}

async function buildRecentPublished(
  svc: ReturnType<typeof getServiceRoleClient>,
  companyId: string,
): Promise<RecentPost[]> {
  const postsR = await svc
    .from("social_post_master")
    .select("id, master_text, state_changed_at")
    .eq("company_id", companyId)
    .eq("state", "published")
    .is("deleted_at", null)
    .order("state_changed_at", { ascending: false })
    .limit(10);

  if (postsR.error || !postsR.data || postsR.data.length === 0) {
    return [];
  }

  const ids = postsR.data.map((p) => p.id as string);
  const variantsR = await svc
    .from("social_post_variant")
    .select("post_master_id, platform")
    .in("post_master_id", ids)
    .is("deleted_at", null);

  const platformsByPost = new Map<string, string[]>();
  for (const v of variantsR.data ?? []) {
    const pid = v.post_master_id as string;
    const plat = (v.platform as string);
    if (!platformsByPost.has(pid)) platformsByPost.set(pid, []);
    platformsByPost.get(pid)!.push(PLATFORM_LABELS[plat] ?? plat);
  }

  return postsR.data.map((p) => ({
    id: p.id as string,
    master_text: (p.master_text as string | null) ?? null,
    state_changed_at: p.state_changed_at as string,
    platforms: platformsByPost.get(p.id as string) ?? [],
  }));
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
