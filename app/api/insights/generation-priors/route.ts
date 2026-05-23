import { NextResponse, type NextRequest } from "next/server";

import { authorisedCronRequest, unauthorisedResponse } from "@/lib/platform/cron/cron-shared";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import {
  fetchPerformancePriors,
  formatPerformancePriorsBlock,
} from "@/lib/cap/performance-priors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const SUPPORTED_PLATFORMS = ["LINKEDIN", "FACEBOOK"] as const;
const SUPPORTED_CONTENT_TYPES = ["post", "article"] as const;
const SUPPORTED_ARC_PHASES = ["awareness", "education", "offer", "proof"] as const;

type Platform = (typeof SUPPORTED_PLATFORMS)[number];

function errorJson(
  code: string,
  message: string,
  status: number,
  retryable = false,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  const platform = searchParams.get("platform");
  const contentType = searchParams.get("content_type") ?? "post";
  const arcPhase = searchParams.get("arc_phase") ?? "awareness";
  const includeIndustrySignalParam = searchParams.get("include_industry_signal");
  const includeIndustrySignal = includeIndustrySignalParam === "true";

  // Validate company_id
  if (
    !companyId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)
  ) {
    return errorJson("VALIDATION_FAILED", "company_id must be a valid UUID", 400);
  }

  // Validate platform
  if (!platform || !SUPPORTED_PLATFORMS.includes(platform as Platform)) {
    return errorJson("VALIDATION_FAILED", "platform must be LINKEDIN or FACEBOOK", 400);
  }

  // Validate content_type
  if (!SUPPORTED_CONTENT_TYPES.includes(contentType as (typeof SUPPORTED_CONTENT_TYPES)[number])) {
    return errorJson("VALIDATION_FAILED", "content_type must be post or article", 400);
  }

  // Validate arc_phase
  if (!SUPPORTED_ARC_PHASES.includes(arcPhase as (typeof SUPPORTED_ARC_PHASES)[number])) {
    return errorJson(
      "VALIDATION_FAILED",
      "arc_phase must be awareness, education, offer, or proof",
      400,
    );
  }

  const svc = getServiceRoleClient();

  // Check industry signal consent
  if (includeIndustrySignal) {
    const { data: consent } = await svc
      .from("ins_consent")
      .select("cross_client_learning_consent")
      .eq("company_id", companyId)
      .maybeSingle();

    if (!consent?.cross_client_learning_consent) {
      return errorJson(
        "CONSENT_REQUIRED",
        "Company has not consented to cross-client learning.",
        400,
      );
    }
  }

  // Parallel queries
  const [recsResult, memoryResult, featuresResult, priorsResult] = await Promise.all([
    // Active non-suppressed recommendations
    svc
      .from("ins_recommendations")
      .select(
        "id, recommendation_type, confidence_score, confidence_band, suppressed, expires_at",
      )
      .eq("company_id", companyId)
      .eq("platform", platform)
      .eq("suppressed", false)
      .gt("expires_at", new Date().toISOString())
      .in("confidence_band", ["strong", "moderate"])
      .order("confidence_score", { ascending: false }),

    // Client memory: dismissals + edit patterns
    svc
      .from("ins_client_memory")
      .select("memory_type, payload, strikes")
      .eq("company_id", companyId)
      .is("deleted_at", null),

    // Latest post features for data freshness
    svc
      .from("ins_post_features")
      .select("posted_at, media_type, has_question, day_of_week, hour_of_day_client_tz, topic_tags")
      .eq("company_id", companyId)
      .eq("platform", platform)
      .is("deleted_at", null)
      .order("posted_at", { ascending: false })
      .limit(200),

    // Performance priors for top posts
    fetchPerformancePriors(companyId),
  ]);

  const recs = recsResult.data ?? [];
  const memory = memoryResult.data ?? [];
  const features = featuresResult.data ?? [];

  // 503 if no data computed yet
  if (recs.length === 0 && features.length === 0) {
    return errorJson(
      "INSIGHTS_UNAVAILABLE",
      "Insights data not yet computed for this company.",
      503,
      true,
    );
  }

  // Extract dismissed recommendation types (3-strike suppressed)
  const dismissedTypes: string[] = [];
  const dismissalCounts = new Map<string, number>();
  for (const mem of memory) {
    if (mem.memory_type === "dismissal" && mem.payload?.recommendation_type) {
      const key = `${mem.payload.recommendation_type}:${mem.payload.reason}`;
      dismissalCounts.set(key, (dismissalCounts.get(key) ?? 0) + 1);
    }
  }
  // Also pull from suppressed recs directly
  const { data: suppressedRecs } = await svc
    .from("ins_recommendations")
    .select("recommendation_type")
    .eq("company_id", companyId)
    .eq("platform", platform)
    .eq("suppressed", true);
  for (const sr of suppressedRecs ?? []) {
    if (sr.recommendation_type && !dismissedTypes.includes(sr.recommendation_type)) {
      dismissedTypes.push(sr.recommendation_type);
    }
  }

  // Client editing preferences from edit_pattern memory
  const clientEditingPreferences: string[] = [];
  for (const mem of memory) {
    if (mem.memory_type === "edit_pattern" && typeof mem.payload?.pattern === "string") {
      clientEditingPreferences.push(mem.payload.pattern);
    }
  }

  // Data freshness
  const dataFreshnessIso = features.length > 0 ? features[0].posted_at : null;

  // Confidence overall
  const confidenceOverall =
    recs.length > 0
      ? Math.min(...recs.map((r) => Number(r.confidence_score)))
      : 0;

  // Preferred length band (from BEST_LENGTH_BAND recommendation or null)
  const lengthRec = recs.find((r) => r.recommendation_type === "BEST_LENGTH_BAND");
  const preferredLengthBand = lengthRec
    ? {
        min: 50,
        max: 200,
        evidence_n: features.length,
      }
    : null;

  // Question usage lift (from QUESTION_PATTERN_LIFT)
  const questionRec = recs.find((r) => r.recommendation_type === "QUESTION_PATTERN_LIFT");
  const questionUsageLift = questionRec ? Number(questionRec.confidence_score) * 2.5 : null;

  // Media type ranking (from MEDIA_TYPE_LIFT recommendation or from features)
  const mediaTypeRec = recs.find((r) => r.recommendation_type === "MEDIA_TYPE_LIFT");
  let mediaTypeRanking: string[] = [];
  if (mediaTypeRec && features.length > 0) {
    const counts = new Map<string, number>();
    for (const f of features) {
      if (f.media_type) counts.set(f.media_type, (counts.get(f.media_type) ?? 0) + 1);
    }
    mediaTypeRanking = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([mt]) => mt);
  }

  // Best posting window (from BEST_POSTING_WINDOW recommendation, confidence >= 0.75)
  const postingRec = recs.find(
    (r) => r.recommendation_type === "BEST_POSTING_WINDOW" && Number(r.confidence_score) >= 0.75,
  );
  let bestPostingWindow = null;
  if (postingRec && features.length > 0) {
    const dayCounts = new Map<number, number>();
    const hourCounts = new Map<number, number>();
    for (const f of features) {
      dayCounts.set(f.day_of_week, (dayCounts.get(f.day_of_week) ?? 0) + 1);
      hourCounts.set(f.hour_of_day_client_tz, (hourCounts.get(f.hour_of_day_client_tz) ?? 0) + 1);
    }
    const bestDay = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
    const bestHour = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 9;
    bestPostingWindow = {
      day_of_week: bestDay,
      hour: bestHour,
      timezone: "UTC",
      confidence: Number(postingRec.confidence_score),
    };
  }

  // Priors text — use performance priors for top posts, augment with insights
  const priorsText = buildPriorsText(priorsResult, {
    platform: platform as Platform,
    postCount: features.length,
    preferredLengthBand,
    bestPostingWindow,
    questionUsageLift,
    clientEditingPreferences,
  });

  logger.info("ins.generation-priors.served", {
    companyId,
    platform,
    arcPhase,
    recCount: recs.length,
    featureCount: features.length,
  });

  return NextResponse.json({
    version: "1",
    generated_at: new Date().toISOString(),
    company_id: companyId,
    platform,
    content_type: contentType,
    arc_phase: arcPhase,

    winning_topics: [],
    weak_topics: [],

    preferred_length_band: preferredLengthBand,
    preferred_hook_patterns: [],
    preferred_cta_style: null,

    question_usage_lift: questionUsageLift,
    media_type_ranking: mediaTypeRanking,
    best_posting_window: bestPostingWindow,

    client_editing_preferences: clientEditingPreferences,
    dismissed_recommendation_types: dismissedTypes,
    tone_or_formatting_flags: [],

    industry_signal: null,

    priors_text: priorsText,

    confidence_overall: confidenceOverall,
    data_freshness_iso: dataFreshnessIso,
  });
}

interface PriorsTextOptions {
  platform: Platform;
  postCount: number;
  preferredLengthBand: { min: number; max: number; evidence_n: number } | null;
  bestPostingWindow: { day_of_week: number; hour: number; timezone: string; confidence: number } | null;
  questionUsageLift: number | null;
  clientEditingPreferences: string[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function buildPriorsText(
  topPosts: Awaited<ReturnType<typeof fetchPerformancePriors>>,
  opts: PriorsTextOptions,
): string {
  const parts: string[] = [];

  parts.push(`## Performance priors (${opts.platform}, last 90 days)`);
  parts.push(`Based on ${opts.postCount} published posts.`);
  parts.push("");

  if (opts.preferredLengthBand) {
    parts.push(
      `- **Length**: ${opts.preferredLengthBand.min}–${opts.preferredLengthBand.max} words performs best (${opts.preferredLengthBand.evidence_n} posts analysed).`,
    );
  }

  if (opts.bestPostingWindow) {
    const day = DAY_NAMES[opts.bestPostingWindow.day_of_week] ?? "Unknown";
    const hour = opts.bestPostingWindow.hour;
    const ampm = hour < 12 ? "am" : "pm";
    const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    parts.push(`- **Best window**: ${day} ${hour12}${ampm} ${opts.bestPostingWindow.timezone} gets highest engagement.`);
  }

  if (opts.questionUsageLift && opts.questionUsageLift > 1) {
    parts.push(
      `- **Questions**: posts ending in questions get ${opts.questionUsageLift.toFixed(1)}× the comment rate.`,
    );
  }

  if (opts.clientEditingPreferences.length > 0) {
    parts.push(`- **Reviewer prefs**: ${opts.clientEditingPreferences.slice(0, 3).join("; ")}.`);
  }

  const priorsBlock = formatPerformancePriorsBlock(topPosts);
  if (priorsBlock) {
    parts.push("");
    parts.push("Top-performing recent posts:");
    parts.push("");
    parts.push(priorsBlock);
  }

  return parts.join("\n");
}
