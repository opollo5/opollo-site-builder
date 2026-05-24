import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  computeConfidence,
  coefficientOfVariation,
  MIN_POSTS_FOR_RECOMMENDATION,
} from "../confidence";
import type { GeneratorFn, PostWithEngagement } from "./types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const generateBestPostingWindow: GeneratorFn = async (companyId, platform, window) => {
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

  // Group by day_of_week × hour_of_day_client_tz
  const cells = new Map<string, PostWithEngagement[]>();
  for (const post of posts) {
    const key = `${post.day_of_week}:${post.hour_of_day_client_tz}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(post);
  }

  // Need at least 12 posts per cell
  const validCells = [...cells.entries()].filter(([, ps]) => ps.length >= 12);
  if (validCells.length < 2) return null;

  const cellStats = validCells.map(([key, ps]) => {
    const [day, hour] = key.split(":").map(Number);
    const rates = ps.map((p) => Number(p.engagement_rate));
    return {
      day,
      hour,
      meanRate: rates.reduce((a, b) => a + b, 0) / rates.length,
      cov: coefficientOfVariation(rates),
      sampleN: ps.length,
      examplePosts: ps.slice(0, 3),
    };
  });

  const [best, second] = cellStats.sort((a, b) => b.meanRate - a.meanRate);
  const lift = best.meanRate / (second.meanRate || 1);

  if (lift < 1.2) return null; // Not meaningful enough

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
    effectMagnitude: Math.min(1, lift - 1),
  });

  if (confidence.band === "below_floor") return null;

  const dayLabel = DAY_LABELS[best.day] ?? `Day ${best.day}`;
  const hourLabel = best.hour === 12 ? "12pm" : best.hour > 12 ? `${best.hour - 12}pm` : `${best.hour}am`;

  return {
    type: "BEST_POSTING_WINDOW",
    headline: `${dayLabel} ${hourLabel} is your best window — ${lift.toFixed(1)}× median`,
    body: `Posts published ${dayLabel} at ${hourLabel} average ${(best.meanRate * 100).toFixed(1)}% engagement (${best.sampleN} posts).`,
    successMetric: "engagement_rate",
    confidenceScore: confidence.score,
    confidenceBand: confidence.band,
    evidence: best.examplePosts.map((p) => ({
      sourceTable: "social_post_analytics_snapshots" as const,
      sourceRowRef: p.bundle_post_id,
      summary: `${DAY_LABELS[p.day_of_week]} ${p.hour_of_day_client_tz}:00, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement`,
    })),
  };
};
