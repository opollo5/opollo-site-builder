import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface IndustryPattern {
  id: string;
  pattern_type: string;
  applies_to_platforms: string[];
  pattern_data: Record<string, unknown>;
  sample_size_n_companies: number;
  sample_size_n_posts: number;
  confidence_score: number;
  mined_at: string;
  expires_at: string;
}

export interface IndustrySignal {
  patterns: IndustryPattern[];
  summary: string;
}

const PATTERN_TYPE_MAP: Record<string, string> = {
  BEST_LENGTH_BAND: "cross_segment_format_pattern",
  BEST_POSTING_WINDOW: "cross_segment_winning_pattern",
  QUESTION_PATTERN_LIFT: "cross_segment_winning_pattern",
  MEDIA_TYPE_LIFT: "cross_segment_winning_pattern",
  HASHTAG_DIMINISHING_RETURNS: "cross_segment_winning_pattern",
  TOPIC_PERFORMANCE: "cross_segment_topic_lift",
};

export async function findApplicablePatterns(
  companyId: string,
  platform: string,
  recommendationType: string,
): Promise<IndustryPattern[]> {
  // Check consent
  const svc = getServiceRoleClient();
  const { data: consentRow } = await svc
    .from("ins_consent")
    .select("cross_client_learning_consent")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!consentRow?.cross_client_learning_consent) return [];

  const patternType = PATTERN_TYPE_MAP[recommendationType];
  if (!patternType) return [];

  const { data, error } = await svc
    .from("ins_pattern_library")
    .select("*")
    .eq("pattern_type", patternType)
    .contains("applies_to_platforms", [platform])
    .gt("expires_at", new Date().toISOString())
    .order("confidence_score", { ascending: false })
    .limit(3);

  if (error) {
    logger.warn("ins.pattern-application.query-failed", {
      companyId,
      error: error.message,
    });
    return [];
  }

  return (data ?? []) as IndustryPattern[];
}

export function buildIndustrySignalSummary(patterns: IndustryPattern[]): string {
  if (patterns.length === 0) return "";

  const lines = patterns.map((p) => {
    const data = p.pattern_data;
    if (p.pattern_type === "cross_segment_format_pattern" && data.word_count_band) {
      return `Across the MSP segment (${p.sample_size_n_companies} companies, ${p.sample_size_n_posts} posts), ${data.word_count_band} posts average ${((data.mean_engagement as number) * 100).toFixed(1)}% engagement.`;
    }
    if (p.pattern_type === "cross_segment_winning_pattern" && data.pattern) {
      return `Industry pattern "${data.pattern}" shows ${data.lift}× lift vs baseline across ${p.sample_size_n_companies} MSP companies.`;
    }
    if (p.pattern_type === "cross_segment_topic_lift" && data.topic) {
      return `Topic "${data.topic}" delivers ${data.lift}× the median engagement across ${p.sample_size_n_companies} MSP companies.`;
    }
    return "";
  });

  return lines.filter(Boolean).join(" ");
}

export async function getIndustrySignal(
  companyId: string,
  platform: string,
): Promise<IndustrySignal | null> {
  const svc = getServiceRoleClient();
  const { data: consentRow } = await svc
    .from("ins_consent")
    .select("cross_client_learning_consent")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!consentRow?.cross_client_learning_consent) return null;

  const { data, error } = await svc
    .from("ins_pattern_library")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("confidence_score", { ascending: false })
    .limit(5);

  if (error || !data || data.length === 0) return null;

  const patterns = data as IndustryPattern[];
  return {
    patterns,
    summary: buildIndustrySignalSummary(patterns),
  };
}
