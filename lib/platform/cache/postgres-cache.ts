import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface AnalyticsCacheRow {
  impressions: number | null;
  engagement_rate: number | null;
  reactions: number | null;
  shares: number | null;
  comments: number | null;
  clicks: number | null;
  platform_specific: Record<string, number | string>;
  fetched_at: string;
}

// Reads the latest analytics row for a draft within the TTL window.
export async function postgresGetAnalytics(
  draftId: string,
  ttlSeconds: number,
): Promise<AnalyticsCacheRow | null> {
  try {
    const svc = getServiceRoleClient();
    const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString();
    const { data, error } = await svc
      .from("social_post_analytics_cache")
      .select("impressions, engagement_rate, reactions, shares, comments, clicks, platform_specific, fetched_at")
      .eq("draft_id", draftId)
      .gte("fetched_at", cutoff)
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn("cache.postgres_analytics_get_failed", { draftId, err: error.message });
      return null;
    }
    if (!data) return null;
    return {
      impressions: (data.impressions as number | null) ?? null,
      engagement_rate: (data.engagement_rate as number | null) ?? null,
      reactions: (data.reactions as number | null) ?? null,
      shares: (data.shares as number | null) ?? null,
      comments: (data.comments as number | null) ?? null,
      clicks: (data.clicks as number | null) ?? null,
      platform_specific: (data.platform_specific as Record<string, number | string>) ?? {},
      fetched_at: data.fetched_at as string,
    };
  } catch (err) {
    logger.warn("cache.postgres_analytics_get_failed", {
      draftId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Like postgresGetAnalytics but ignores the TTL window — returns the latest row regardless of age.
export async function postgresGetAnalyticsStale(draftId: string): Promise<AnalyticsCacheRow | null> {
  return postgresGetAnalytics(draftId, Number.MAX_SAFE_INTEGER);
}

// Inserts a new analytics cache row.
export async function postgresSetAnalytics(
  draftId: string,
  data: AnalyticsCacheRow,
): Promise<boolean> {
  try {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("social_post_analytics_cache").insert({
      draft_id: draftId,
      fetched_at: data.fetched_at,
      impressions: data.impressions,
      engagement_rate: data.engagement_rate,
      reactions: data.reactions,
      shares: data.shares,
      comments: data.comments,
      clicks: data.clicks,
      platform_specific: data.platform_specific,
    });
    if (error) {
      logger.warn("cache.postgres_analytics_set_failed", { draftId, err: error.message });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn("cache.postgres_analytics_set_failed", {
      draftId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
