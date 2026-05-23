import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  computeConfidence,
  coefficientOfVariation,
  MIN_POSTS_FOR_RECOMMENDATION,
} from "../confidence";
import type { GeneratorFn, PostWithEngagement } from "./types";

export const generateTopicPerformance: GeneratorFn = async (companyId, platform, window) => {
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

  // Phase 2 W8 prerequisite: topic_tags must be populated
  const postsWithTopics = posts.filter((p) => p.topic_tags && p.topic_tags.length > 0);
  if (postsWithTopics.length === 0) return null;

  // Build topic → engagement rate map
  const topicRates = new Map<string, number[]>();
  for (const post of postsWithTopics) {
    for (const tag of post.topic_tags ?? []) {
      if (!topicRates.has(tag)) topicRates.set(tag, []);
      topicRates.get(tag)!.push(Number(post.engagement_rate));
    }
  }

  // Filter to topics with ≥ 5 posts
  const validTopics = [...topicRates.entries()]
    .filter(([, rates]) => rates.length >= 5)
    .map(([topic, rates]) => ({
      topic,
      meanRate: rates.reduce((a, b) => a + b, 0) / rates.length,
      cov: coefficientOfVariation(rates),
      sampleN: rates.length,
    }));

  if (validTopics.length < 2) return null;

  const sorted = validTopics.sort((a, b) => b.meanRate - a.meanRate);
  const best = sorted[0];
  const median = sorted[Math.floor(sorted.length / 2)];
  const lift = (best.meanRate - median.meanRate) / (median.meanRate || 1);

  if (lift < 0.2) return null; // < 20% lift over median — not worth surfacing

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

  const topPosts = postsWithTopics
    .filter((p) => (p.topic_tags ?? []).includes(best.topic))
    .slice(0, 3);

  return {
    type: "TOPIC_PERFORMANCE",
    headline: `"${best.topic}" posts outperform your median by ${(lift * 100).toFixed(0)}%`,
    body: `${best.sampleN} posts tagged "${best.topic}" average ${(best.meanRate * 100).toFixed(1)}% engagement.`,
    successMetric: "engagement_rate",
    confidenceScore: confidence.score,
    confidenceBand: confidence.band,
    evidence: topPosts.map((p) => ({
      sourceTable: "ins_post_features" as const,
      sourceRowRef: p.bundle_post_id,
      summary: `Topic: ${best.topic}, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement`,
    })),
  };
};
