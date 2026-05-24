export interface PostWithEngagement {
  bundle_post_id: string;
  posted_at: string;
  engagement_rate: number | string;
  impressions: number;
  word_count: number;
  has_question: boolean;
  hashtag_count: number;
  media_type: string | null;
  day_of_week: number;
  hour_of_day_client_tz: number;
  topic_tags: string[] | null;
}

export interface RecommendationCandidate {
  type: string;
  headline: string;
  body: string;
  successMetric: string;
  confidenceScore: number;
  confidenceBand: "strong" | "moderate" | "below_floor";
  evidence: Array<{
    sourceTable: "social_post_analytics_snapshots" | "ins_post_features";
    sourceRowRef: string;
    summary: string;
  }>;
}

export type GeneratorFn = (
  companyId: string,
  platform: "LINKEDIN" | "FACEBOOK",
  window: { days: number },
) => Promise<RecommendationCandidate | null>;
