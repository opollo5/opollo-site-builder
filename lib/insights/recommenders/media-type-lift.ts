import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  computeConfidence,
  coefficientOfVariation,
  MIN_POSTS_FOR_RECOMMENDATION,
} from "../confidence";
import type { GeneratorFn, PostWithEngagement } from "./types";

export const generateMediaTypeLift: GeneratorFn = async (companyId, platform, window) => {
  const svc = getServiceRoleClient();
  const cutoff = new Date(Date.now() - window.days * 24 * 60 * 60 * 1000).toISOString();

  const { data: rawPosts } = await svc.rpc("get_posts_with_engagement", {
    p_company_id: companyId,
    p_platform: platform,
    p_cutoff: cutoff,
    p_min_impressions: 50,
  });
  const posts = rawPosts as PostWithEngagement[] | null;

  if (!posts || posts.length < MIN_POSTS_FOR_RECOMMENDATION) return null;

  // Group by media_type
  const byType = new Map<string, PostWithEngagement[]>();
  for (const post of posts) {
    const type = post.media_type ?? "text";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(post);
  }

  const validTypes = [...byType.entries()].filter(([, ps]) => ps.length >= 5);
  if (validTypes.length < 2) return null;

  const typeStats = validTypes.map(([type, ps]) => {
    const rates = ps.map((p) => Number(p.engagement_rate));
    return {
      type,
      meanRate: rates.reduce((a, b) => a + b, 0) / rates.length,
      cov: coefficientOfVariation(rates),
      sampleN: ps.length,
      examplePosts: ps.slice(0, 3),
    };
  });

  const [best, second] = typeStats.sort((a, b) => b.meanRate - a.meanRate);
  const lift = (best.meanRate - second.meanRate) / (second.meanRate || 1);

  if (lift < 0.1) return null; // < 10% difference — not worth surfacing

  const now = Date.now();
  const recentPosts = posts.filter(
    (p) => new Date(p.posted_at).getTime() > now - 30 * 24 * 60 * 60 * 1000,
  ).length;
  const sixtyDayPosts = posts.filter(
    (p) => new Date(p.posted_at).getTime() > now - 60 * 24 * 60 * 60 * 1000,
  ).length;

  const confidence = computeConfidence({
    postsInWindow: posts.length,
    postsFromLast30d: recentPosts,
    postsFromLast60d: sixtyDayPosts,
    coefficientOfVariation: best.cov,
    effectMagnitude: Math.min(1, lift),
  });

  if (confidence.band === "below_floor") return null;

  return {
    type: "MEDIA_TYPE_LIFT",
    headline: `${capitalize(best.type)} posts outperform ${best.type === "text" ? "media" : "text"} by ${(lift * 100).toFixed(0)}%`,
    body: `${best.sampleN} ${best.type} posts averaged ${(best.meanRate * 100).toFixed(1)}% engagement vs ${(second.meanRate * 100).toFixed(1)}% for ${second.type}.`,
    successMetric: "engagement_rate",
    confidenceScore: confidence.score,
    confidenceBand: confidence.band,
    evidence: best.examplePosts.map((p) => ({
      sourceTable: "social_post_analytics_snapshots" as const,
      sourceRowRef: p.bundle_post_id,
      summary: `${p.media_type ?? "text"} post, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement`,
    })),
  };
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
