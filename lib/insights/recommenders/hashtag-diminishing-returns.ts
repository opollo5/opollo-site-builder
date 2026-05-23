import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  computeConfidence,
  coefficientOfVariation,
  MIN_POSTS_FOR_RECOMMENDATION,
} from "../confidence";
import type { GeneratorFn, PostWithEngagement } from "./types";

export const generateHashtagDiminishingReturns: GeneratorFn = async (
  companyId,
  platform,
  window,
) => {
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

  // Bucket by hashtag count: 0, 1-3, 4-6, 7+
  const buckets: Record<string, PostWithEngagement[]> = {
    "0": posts.filter((p) => p.hashtag_count === 0),
    "1-3": posts.filter((p) => p.hashtag_count >= 1 && p.hashtag_count <= 3),
    "4-6": posts.filter((p) => p.hashtag_count >= 4 && p.hashtag_count <= 6),
    "7+": posts.filter((p) => p.hashtag_count >= 7),
  };

  const validBuckets = Object.entries(buckets).filter(([, ps]) => ps.length >= 3);
  if (validBuckets.length < 2) return null;

  const bucketStats = validBuckets.map(([name, ps]) => ({
    name,
    meanRate: ps.reduce((s, p) => s + Number(p.engagement_rate), 0) / ps.length,
    cov: coefficientOfVariation(ps.map((p) => Number(p.engagement_rate))),
    sampleN: ps.length,
    examplePosts: ps.slice(0, 3),
  }));

  // Find inflection point: where adding more hashtags decreases engagement
  const ordered = ["0", "1-3", "4-6", "7+"].map((n) => bucketStats.find((b) => b.name === n)).filter(Boolean) as typeof bucketStats;
  if (ordered.length < 2) return null;

  let inflectionIdx = -1;
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].meanRate < ordered[i - 1].meanRate) {
      inflectionIdx = i;
      break;
    }
  }

  if (inflectionIdx < 1) return null; // No diminishing returns found

  const peakBucket = ordered[inflectionIdx - 1];
  const declineBucket = ordered[inflectionIdx];
  const drop = (peakBucket.meanRate - declineBucket.meanRate) / (peakBucket.meanRate || 1);

  if (drop < 0.1) return null; // < 10% drop — not meaningful

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
    coefficientOfVariation: peakBucket.cov,
    effectMagnitude: Math.min(1, drop),
  });

  if (confidence.band === "below_floor") return null;

  const thresholdLabel = peakBucket.name === "0" ? "0" : peakBucket.name === "1-3" ? "3" : "6";

  return {
    type: "HASHTAG_DIMINISHING_RETURNS",
    headline: `Posts with more than ${thresholdLabel} hashtags get ${(drop * 100).toFixed(0)}% less engagement`,
    body: `Your sweet spot is ${peakBucket.name} hashtags (${(peakBucket.meanRate * 100).toFixed(1)}% avg). More hashtags drop to ${(declineBucket.meanRate * 100).toFixed(1)}%.`,
    successMetric: "engagement_rate",
    confidenceScore: confidence.score,
    confidenceBand: confidence.band,
    evidence: peakBucket.examplePosts.map((p) => ({
      sourceTable: "ins_post_features" as const,
      sourceRowRef: p.bundle_post_id,
      summary: `${p.hashtag_count} hashtags, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement`,
    })),
  };
};
