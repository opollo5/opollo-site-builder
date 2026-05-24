import { NextResponse, type NextRequest } from "next/server";

import { authorisedCronRequest, unauthorisedResponse } from "@/lib/platform/cron/cron-shared";
import { aggregateEditPatterns } from "@/lib/insights/memory-aggregator";
import { generateBestLengthBand } from "@/lib/insights/recommenders/best-length-band";
import { generateBestPostingWindow } from "@/lib/insights/recommenders/best-posting-window";
import { generateHashtagDiminishingReturns } from "@/lib/insights/recommenders/hashtag-diminishing-returns";
import { generateMediaTypeLift } from "@/lib/insights/recommenders/media-type-lift";
import { generateQuestionPatternLift } from "@/lib/insights/recommenders/question-pattern-lift";
import { generateTopicPerformance } from "@/lib/insights/recommenders/topic-performance";
import type { GeneratorFn } from "@/lib/insights/recommenders/types";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const RECOMMENDATION_GENERATORS: GeneratorFn[] = [
  generateBestLengthBand,
  generateBestPostingWindow,
  generateQuestionPatternLift,
  generateMediaTypeLift,
  generateHashtagDiminishingReturns,
  generateTopicPerformance,
];

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const startTime = Date.now();
  const svc = getServiceRoleClient();

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: eligibleCompanies, error: rpcErr } = await svc.rpc(
    "find_companies_eligible_for_recompute",
    { min_posts: 20, cutoff_iso: cutoff },
  );

  if (rpcErr) {
    logger.error("ins.recompute.rpc_failed", { error: rpcErr.message });
    return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
  }

  let companiesProcessed = 0;
  let recommendationsWritten = 0;

  for (const company of eligibleCompanies ?? []) {
    try {
      await aggregateEditPatterns(company.company_id);

      for (const generator of RECOMMENDATION_GENERATORS) {
        for (const platform of ["LINKEDIN", "FACEBOOK"] as const) {
          const candidate = await generator(company.company_id, platform, { days: 90 });
          if (candidate && candidate.confidenceBand !== "below_floor") {
            const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
            const { data: rec } = await svc
              .from("ins_recommendations")
              .insert({
                company_id: company.company_id,
                platform,
                recommendation_type: candidate.type,
                headline: candidate.headline,
                body: candidate.body,
                success_metric: candidate.successMetric,
                confidence_score: candidate.confidenceScore,
                confidence_band: candidate.confidenceBand,
                expires_at: expiresAt,
              })
              .select()
              .single();

            if (rec && candidate.evidence) {
              await svc.from("ins_recommendation_evidence").insert(
                candidate.evidence.map((e) => ({
                  recommendation_id: rec.id,
                  source_table: e.sourceTable,
                  source_row_ref: e.sourceRowRef,
                  summary: e.summary,
                })),
              );
            }

            recommendationsWritten++;
          }
        }
      }

      // Accounting parity — cap_campaign_id nullable as of migration 0146
      await svc.from("cap_generation_runs").insert({
        cap_campaign_post_id: null,
        cap_campaign_id: null,
        operation: "insights_recompute",
        prompt_version: 1,
        prompt_used: "insights-recompute-cron",
        model: "none",
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        latency_ms: 0,
        status: "success",
      });

      companiesProcessed++;
    } catch (err) {
      logger.error("ins.recompute.company_failed", {
        companyId: company.company_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const durationMs = Date.now() - startTime;

  await svc.from("ins_ingest_log").insert({
    cron_route: "/api/cron/insights-recompute",
    company_id: null,
    posts_processed: 0,
    metrics_recorded: recommendationsWritten,
    features_extracted: 0,
    errors: [],
    duration_ms: durationMs,
  });

  logger.info("ins.recompute.completed", { companiesProcessed, recommendationsWritten, durationMs });

  return NextResponse.json({ ok: true, companiesProcessed, recommendationsWritten, durationMs });
}
