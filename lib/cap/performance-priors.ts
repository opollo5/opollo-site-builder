import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface PerformancePrior {
  engagementRate: number;
  content: string;
}

/**
 * Queries social_post_analytics_snapshots for the top 3 posts by engagement_rate
 * for the given company over the last 90 days (impressions >= 50, non-null rate).
 * Returns [] on any error or when no qualifying posts exist — callers should
 * treat an empty result as "no priors available, proceed without".
 */
export async function fetchPerformancePriors(
  companyId: string,
): Promise<PerformancePrior[]> {
  const svc = getServiceRoleClient();
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  // Step 1: resolve profile IDs for this company (typically a small set)
  const { data: profiles, error: profilesErr } = await svc
    .from("platform_social_profiles")
    .select("id")
    .eq("company_id", companyId);

  if (profilesErr) {
    logger.warn("cap.performance-priors.profiles_query_failed", {
      companyId,
      error: profilesErr.message,
    });
    return [];
  }

  if (!profiles || profiles.length === 0) return [];

  const profileIds = profiles.map((p) => p.id as string);

  // Step 2: fetch top snapshots for those profiles ordered by engagement descending.
  // Limit 20 to ensure we find 3 unique posts after JS-side deduplication.
  const { data: rows, error: analyticsErr } = await svc
    .from("social_post_analytics_snapshots")
    .select("bundle_post_id, content, engagement_rate, impressions")
    .in("profile_id", profileIds)
    .not("engagement_rate", "is", null)
    .gte("impressions", 50)
    .gte("posted_at", cutoff)
    .order("engagement_rate", { ascending: false })
    .order("impressions", { ascending: false })
    .limit(20);

  if (analyticsErr) {
    logger.warn("cap.performance-priors.analytics_query_failed", {
      companyId,
      error: analyticsErr.message,
    });
    return [];
  }

  // Deduplicate by bundle_post_id — the same post can appear across multiple daily
  // snapshot dates. Keep the first occurrence (highest engagement_rate due to ORDER BY).
  const seen = new Set<string>();
  const priors: PerformancePrior[] = [];

  for (const row of rows ?? []) {
    const postId = row.bundle_post_id as string | null;
    const content = typeof row.content === "string" ? row.content : null;
    const rawRate = row.engagement_rate;
    const rawImpressions = row.impressions as number | null;

    // Belt-and-suspenders: re-check filters in JS in case of data inconsistencies
    if (!postId || seen.has(postId) || !content) continue;
    if (rawRate === null || rawRate === undefined) continue;
    if (rawImpressions === null || rawImpressions < 50) continue;

    seen.add(postId);
    priors.push({
      engagementRate: Number(rawRate),
      content,
    });

    if (priors.length === 3) break;
  }

  return priors;
}

/**
 * Formats a "Performance priors" block for injection into the CAP system prompt.
 * Returns an empty string when priors is empty — callers should skip the block
 * entirely rather than inject a placeholder.
 */
export function formatPerformancePriorsBlock(priors: PerformancePrior[]): string {
  if (priors.length === 0) return "";

  const lines = priors.map((p, i) => {
    const pct = (p.engagementRate * 100).toFixed(1);
    const raw = p.content.replace(/[\r\n]+/g, " ").trim();
    const truncated = raw.length > 400 ? raw.slice(0, 400) + "…" : raw;
    return `${i + 1}. [${pct}%] — ${truncated}`;
  });

  return [
    "PERFORMANCE PRIORS — TOP-PERFORMING POSTS FOR THIS CLIENT (last 90 days)",
    "",
    "These posts had the highest engagement rate. Use them as directional priors",
    "for what resonates with this client's audience. Do not copy them. Learn from",
    "their structure, tone, length, and angle.",
    "",
    ...lines,
  ].join("\n");
}
