import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  computeConfidence,
  coefficientOfVariation,
  MIN_POSTS_FOR_RECOMMENDATION,
} from "../confidence";
import type { GeneratorFn, PostWithEngagement } from "./types";

export const generateQuestionPatternLift: GeneratorFn = async (companyId, platform, window) => {
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

  const withQuestion = posts.filter((p) => p.has_question);
  const withoutQuestion = posts.filter((p) => !p.has_question);

  if (withQuestion.length < 5 || withoutQuestion.length < 5) return null;

  const meanWith =
    withQuestion.reduce((s, p) => s + Number(p.engagement_rate), 0) / withQuestion.length;
  const meanWithout =
    withoutQuestion.reduce((s, p) => s + Number(p.engagement_rate), 0) / withoutQuestion.length;

  const lift = meanWith / (meanWithout || 1);
  if (lift < 1.5) return null;

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
    coefficientOfVariation: coefficientOfVariation(withQuestion.map((p) => Number(p.engagement_rate))),
    effectMagnitude: Math.min(1, lift - 1),
  });

  if (confidence.band === "below_floor") return null;

  return {
    type: "QUESTION_PATTERN_LIFT",
    headline: `Posts with questions get ${lift.toFixed(1)}× the engagement`,
    body: `Based on ${withQuestion.length} posts with questions vs ${withoutQuestion.length} without.`,
    successMetric: "engagement_rate",
    confidenceScore: confidence.score,
    confidenceBand: confidence.band,
    evidence: withQuestion.slice(0, 3).map((p) => ({
      sourceTable: "ins_post_features" as const,
      sourceRowRef: p.bundle_post_id,
      summary: `Question post, ${(Number(p.engagement_rate) * 100).toFixed(1)}% engagement`,
    })),
  };
};
