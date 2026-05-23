import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface PatternMineResult {
  companiesContributing: number;
  postsContributing: number;
  patternsWritten: number;
}

const MIN_COMPANIES = 5;
const MIN_POSTS = 100;
const TTL_DAYS = 180;

interface ConsentingCompany {
  company_id: string;
}

interface FeatureRow {
  engagement_rate: number | null;
  has_question: boolean | null;
  word_count: number | null;
  topic_tags: string[] | null;
}

function wordCountBand(wc: number): string {
  if (wc < 50) return "very_short";
  if (wc < 100) return "short";
  if (wc < 200) return "medium";
  if (wc < 400) return "long";
  return "very_long";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export async function minePatterns(): Promise<PatternMineResult> {
  const svc = getServiceRoleClient();

  // 1. Collect consenting companies
  const { data: consenting, error: consentErr } = await svc
    .from("ins_consent")
    .select("company_id")
    .eq("cross_client_learning_consent", true);

  if (consentErr || !consenting) {
    logger.error("ins.pattern-mine.consent-query-failed", { error: consentErr?.message });
    return { companiesContributing: 0, postsContributing: 0, patternsWritten: 0 };
  }

  const companyIds = (consenting as ConsentingCompany[]).map((r) => r.company_id);
  if (companyIds.length < MIN_COMPANIES) {
    logger.info("ins.pattern-mine.below-floor", {
      companies: companyIds.length,
      minRequired: MIN_COMPANIES,
    });
    return { companiesContributing: companyIds.length, postsContributing: 0, patternsWritten: 0 };
  }

  // 2. Fetch anonymised feature rows (no content, no PII)
  const { data: features, error: featErr } = await svc
    .from("ins_post_features")
    .select("engagement_rate, has_question, word_count, topic_tags")
    .in("company_id", companyIds)
    .not("engagement_rate", "is", null)
    .is("deleted_at", null);

  if (featErr || !features) {
    logger.error("ins.pattern-mine.features-query-failed", { error: featErr?.message });
    return { companiesContributing: companyIds.length, postsContributing: 0, patternsWritten: 0 };
  }

  const rows = features as FeatureRow[];
  if (rows.length < MIN_POSTS) {
    logger.info("ins.pattern-mine.posts-below-floor", { posts: rows.length, minRequired: MIN_POSTS });
    return { companiesContributing: companyIds.length, postsContributing: rows.length, patternsWritten: 0 };
  }

  const expiresAt = new Date(Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nCompanies = companyIds.length;
  const nPosts = rows.length;
  let patternsWritten = 0;

  // 3a. cross_segment_winning_pattern — has_question lift
  const withQ = rows.filter((r) => r.has_question === true && r.engagement_rate != null);
  const withoutQ = rows.filter((r) => r.has_question === false && r.engagement_rate != null);
  if (withQ.length > 0 && withoutQ.length > 0) {
    const avgQ = withQ.reduce((s, r) => s + r.engagement_rate!, 0) / withQ.length;
    const avgNoQ = withoutQ.reduce((s, r) => s + r.engagement_rate!, 0) / withoutQ.length;
    const lift = avgNoQ > 0 ? avgQ / avgNoQ : null;
    if (lift !== null) {
      const { error } = await svc.from("ins_pattern_library").insert({
        pattern_type: "cross_segment_winning_pattern",
        applies_to_platforms: ["LINKEDIN", "FACEBOOK"],
        pattern_data: { pattern: "has_question=true", lift: Math.round(lift * 1000) / 1000 },
        sample_size_n_companies: nCompanies,
        sample_size_n_posts: nPosts,
        confidence_score: Math.min(1, Math.max(0, Math.min(nCompanies / 20, nPosts / 1000))),
        expires_at: expiresAt,
      });
      if (!error) patternsWritten++;
    }
  }

  // 3b. cross_segment_topic_lift — per topic, mean vs median engagement
  const topicEngagement: Record<string, number[]> = {};
  for (const row of rows) {
    if (!row.topic_tags || row.engagement_rate == null) continue;
    for (const tag of row.topic_tags) {
      if (!topicEngagement[tag]) topicEngagement[tag] = [];
      topicEngagement[tag].push(row.engagement_rate);
    }
  }
  const allRates = rows.map((r) => r.engagement_rate!).filter((v) => v != null);
  const globalMedian = median(allRates);

  for (const [topic, rates] of Object.entries(topicEngagement)) {
    if (rates.length < 10) continue;
    const mean = rates.reduce((s, v) => s + v, 0) / rates.length;
    const lift = globalMedian > 0 ? mean / globalMedian : null;
    if (lift === null) continue;
    const { error } = await svc.from("ins_pattern_library").insert({
      pattern_type: "cross_segment_topic_lift",
      applies_to_platforms: ["LINKEDIN", "FACEBOOK"],
      pattern_data: { topic, mean_engagement: Math.round(mean * 10000) / 10000, lift: Math.round(lift * 1000) / 1000 },
      sample_size_n_companies: nCompanies,
      sample_size_n_posts: rates.length,
      confidence_score: Math.min(1, Math.max(0, rates.length / 500)),
      expires_at: expiresAt,
    });
    if (!error) patternsWritten++;
  }

  // 3c. cross_segment_format_pattern — word count band vs engagement
  const bandEngagement: Record<string, number[]> = {};
  for (const row of rows) {
    if (row.word_count == null || row.engagement_rate == null) continue;
    const band = wordCountBand(row.word_count);
    if (!bandEngagement[band]) bandEngagement[band] = [];
    bandEngagement[band].push(row.engagement_rate);
  }

  for (const [band, rates] of Object.entries(bandEngagement)) {
    if (rates.length < 10) continue;
    const mean = rates.reduce((s, v) => s + v, 0) / rates.length;
    const { error } = await svc.from("ins_pattern_library").insert({
      pattern_type: "cross_segment_format_pattern",
      applies_to_platforms: ["LINKEDIN", "FACEBOOK"],
      pattern_data: { word_count_band: band, mean_engagement: Math.round(mean * 10000) / 10000 },
      sample_size_n_companies: nCompanies,
      sample_size_n_posts: rates.length,
      confidence_score: Math.min(1, Math.max(0, rates.length / 500)),
      expires_at: expiresAt,
    });
    if (!error) patternsWritten++;
  }

  logger.info("ins.pattern-mine.complete", {
    companiesContributing: nCompanies,
    postsContributing: nPosts,
    patternsWritten,
  });

  return { companiesContributing: nCompanies, postsContributing: nPosts, patternsWritten };
}
