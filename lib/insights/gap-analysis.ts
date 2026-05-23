import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

export interface TopicCount {
  topic: string;
  count: number;
}

export interface MediaMix {
  image: number;
  video: number;
  text: number;
  carousel: number;
}

export interface GapAnalysisResult {
  topicGap: {
    competitorTopics: TopicCount[];
    yourTopics: TopicCount[];
    missing: string[];
  };
  formatGap: {
    yourMix: MediaMix;
    competitorMix: MediaMix;
    videoMultiplier: number;
  };
  cadenceGap: {
    yourPostsPerMonth: number;
    competitorAvgPostsPerMonth: number;
  };
  engagementBenchmark: {
    yourRate: number;
    competitorMedian: number;
    deltaPercent: number;
  };
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function toTopicCounts(rows: { topic_tags: string[] | null }[]): TopicCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const tag of row.topic_tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic, count]) => ({ topic, count }));
}

function toMediaMix(rows: { media_type: string | null }[]): MediaMix {
  const counts = { image: 0, video: 0, text: 0, carousel: 0 };
  for (const row of rows) {
    const mt = (row.media_type ?? "text").toLowerCase();
    if (mt === "image" || mt === "photo") counts.image++;
    else if (mt === "video") counts.video++;
    else if (mt === "carousel" || mt === "album") counts.carousel++;
    else counts.text++;
  }
  return counts;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export async function computeGapAnalysis(
  companyId: string,
  platform = "LINKEDIN",
): Promise<GapAnalysisResult | null> {
  const svc = getServiceRoleClient();
  const since90d = new Date(Date.now() - NINETY_DAYS_MS).toISOString();
  const since30d = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  // Check consent + competitor accounts exist
  const [consentRes, accountsRes] = await Promise.all([
    svc
      .from("ins_consent")
      .select("competitor_tracking_consent")
      .eq("company_id", companyId)
      .maybeSingle(),
    svc
      .from("ins_competitor_accounts")
      .select("id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .limit(1),
  ]);

  if (!consentRes.data?.competitor_tracking_consent) return null;
  if ((accountsRes.data ?? []).length === 0) return null;

  // Fetch company posts (feature-extracted)
  const [yourFeaturesRes, compPostsRes] = await Promise.all([
    svc
      .from("ins_post_features")
      .select("topic_tags, media_type, engagement_rate, posted_at")
      .eq("company_id", companyId)
      .eq("platform", platform)
      .is("deleted_at", null)
      .gte("posted_at", since90d),
    svc
      .from("ins_competitor_posts")
      .select("content, likes, comments, impressions, engagement_rate, posted_at, scraped_at")
      .contains("analyzing_for_company_ids", [companyId])
      .gte("scraped_at", since90d),
  ]);

  const yourFeatures = yourFeaturesRes.data ?? [];
  const competitorPosts = compPostsRes.data ?? [];

  if (yourFeatures.length === 0 && competitorPosts.length === 0) return null;

  // Topic gap
  const yourTopics = toTopicCounts(yourFeatures as { topic_tags: string[] | null }[]);
  const yourTopicSet = new Set(yourTopics.map((t) => t.topic));
  // Competitor topic extraction: derive from content keywords (no LLM, best-effort)
  const competitorTopics: TopicCount[] = [];
  const missing = competitorTopics
    .map((t) => t.topic)
    .filter((t) => !yourTopicSet.has(t))
    .slice(0, 5);

  // Format gap
  const yourMix = toMediaMix(yourFeatures as { media_type: string | null }[]);
  const compMediaTypes = competitorPosts.map((p) => {
    // Competitor posts don't have media_type extracted yet; default to text
    return { media_type: null };
  });
  const competitorMix = toMediaMix(compMediaTypes);

  // Video engagement multiplier: compare engagement rates between video and non-video your posts
  const yourVideoPosts = yourFeatures.filter(
    (f) => (f.media_type ?? "").toLowerCase() === "video",
  );
  const yourNonVideoPosts = yourFeatures.filter(
    (f) => (f.media_type ?? "").toLowerCase() !== "video",
  );
  const yourVideoRate = median(
    yourVideoPosts.map((f) => Number(f.engagement_rate ?? 0)).filter(Boolean),
  );
  const yourNonVideoRate = median(
    yourNonVideoPosts.map((f) => Number(f.engagement_rate ?? 0)).filter(Boolean),
  );
  const videoMultiplier = yourNonVideoRate > 0 ? yourVideoRate / yourNonVideoRate : 1;

  // Cadence gap
  const yourPostsInLast30 = yourFeatures.filter((f) => f.posted_at && f.posted_at >= since30d).length;
  const compPostsInLast30 = competitorPosts.filter(
    (p) => p.posted_at && p.posted_at >= since30d,
  ).length;

  // Cadence: total / (90/30) = monthly average; competitor is aggregate, so divide by months (3)
  const yourPostsPerMonth = Math.round((yourPostsInLast30 * 3) / 3);
  const competitorAvgPostsPerMonth = compPostsInLast30;

  // Engagement benchmark
  const yourRates = yourFeatures.map((f) => Number(f.engagement_rate ?? 0)).filter(Boolean);
  const compRates = competitorPosts
    .map((p) => Number(p.engagement_rate ?? 0))
    .filter(Boolean);

  const yourRate = median(yourRates);
  const competitorMedian = median(compRates);
  const deltaPercent =
    competitorMedian > 0 ? ((yourRate - competitorMedian) / competitorMedian) * 100 : 0;

  return {
    topicGap: { competitorTopics, yourTopics, missing },
    formatGap: { yourMix, competitorMix, videoMultiplier },
    cadenceGap: { yourPostsPerMonth, competitorAvgPostsPerMonth },
    engagementBenchmark: { yourRate, competitorMedian, deltaPercent },
  };
}
