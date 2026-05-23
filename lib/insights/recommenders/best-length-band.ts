import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  computeConfidence,
  coefficientOfVariation,
  MIN_POSTS_FOR_RECOMMENDATION,
} from "../confidence";
import type { GeneratorFn, PostWithEngagement } from "./types";

export const generateBestLengthBand: GeneratorFn = async (companyId, platform, window) => {
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

  const buckets = {
    short: posts.filter((p) => p.word_count <= 100),
    medium: posts.filter((p) => p.word_count > 100 && p.word_count <= 200),
    long: posts.filter((p) => p.word_count > 200 && p.word_count <= 300),
    very_long: posts.filter((p) => p.word_count > 300),
  };

  const validBuckets = Object.entries(buckets).filter(([, ps]) => ps.length >= 5);
  if (validBuckets.length < 2) return null;

  const bucketStats = validBuckets.map(([name, ps]) => {
    const rates = ps.map((p) => Number(p.engagement_rate));
    return {
      name,
      meanRate: rates.reduce((a, b) => a + b, 0) / rates.length,
      cov: coefficientOfVariation(rates),
      sampleN: ps.length,
      examplePosts: ps.slice(0, 3),
    };
  });

  const [best, second] = bucketStats.sort((a, b) => b.meanRate - a.meanRate);
  const lift = (best.meanRate - second.meanRate) / (second.meanRate || 1);

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
    effectMagnitude: Math.min(1, Math.abs(lift)),
  });

  if (confidence.band === "below_floor") return null;

  const bandLabel: Record<string, string> = {
    short: "under 100 words",
    medium: "100–200 words",
    long: "200–300 words",
    very_long: "300+ words",
  };

  return {
    type: "BEST_LENGTH_BAND",
    headline: `Posts ${bandLabel[best.name]} get ${(lift * 100).toFixed(0)}% more engagement`,
    body: `Based on ${posts.length} ${platform} posts in the last ${window.days} days.`,
    successMetric: "engagement_rate",
    confidenceScore: confidence.score,
    confidenceBand: confidence.band,
    evidence: best.examplePosts.map((p) => ({
      sourceTable: "social_post_analytics_snapshots" as const,
      sourceRowRef: p.bundle_post_id,
      summary: `${p.word_count} words, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement`,
    })),
  };
};
