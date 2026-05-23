import { NextResponse, type NextRequest } from "next/server";

import { authorisedCronRequest, unauthorisedResponse } from "@/lib/platform/cron/cron-shared";
import { createApifyAdapter } from "@/lib/insights/sources/apify";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Schedule: 0 7 * * * (daily 07:00 UTC)

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const startMs = Date.now();
  const svc = getServiceRoleClient();
  const adapter = createApifyAdapter();

  if (!adapter.isConfigured()) {
    await svc.from("ins_ingest_log").insert({
      cron_route: "/api/cron/insights-competitor-scrape",
      company_id: null,
      posts_processed: 0,
      metrics_recorded: 0,
      features_extracted: 0,
      errors: [{ note: "apify_unconfigured", message: "APIFY_TOKEN not set — cron is no-op" }],
      duration_ms: 0,
    });

    logger.info("ins.competitor-scrape.no_op", { reason: "apify_unconfigured" });
    return NextResponse.json({ ok: true, noop: true, reason: "apify_unconfigured" });
  }

  // Fetch companies with competitor_tracking_consent = true
  const { data: consentingCompanies, error: consentErr } = await svc
    .from("ins_consent")
    .select("company_id")
    .eq("competitor_tracking_consent", true);

  if (consentErr) {
    logger.error("ins.competitor-scrape.consent_query_failed", { error: consentErr.message });
    return NextResponse.json({ ok: false, error: consentErr.message }, { status: 500 });
  }

  const companyIds = (consentingCompanies ?? []).map((r) => r.company_id);

  let postsProcessed = 0;
  let metricsRecorded = 0;
  const errors: { companyId: string; handle: string; message: string }[] = [];

  for (const companyId of companyIds) {
    // Fetch active competitor accounts for this company
    const { data: accounts } = await svc
      .from("ins_competitor_accounts")
      .select("id, platform, competitor_handle")
      .eq("company_id", companyId)
      .is("deleted_at", null);

    for (const account of accounts ?? []) {
      try {
        const result = await adapter.scheduleScrape({
          platform: account.platform as string,
          handle: account.competitor_handle,
          companyId,
        });

        if (!result.ok || !result.runId) {
          errors.push({ companyId, handle: account.competitor_handle, message: result.reason ?? "schedule_failed" });
          continue;
        }

        // Fetch results (synchronous — actor.call() blocks until done)
        const posts = await adapter.getResults(result.runId);

        for (const post of posts) {
          const { error: insertErr } = await svc
            .from("ins_competitor_posts")
            .upsert(
              {
                analyzing_for_company_ids: [companyId],
                competitor_account_id: account.id,
                platform: account.platform,
                external_post_id: post.externalPostId,
                content: post.content,
                impressions: post.impressions,
                likes: post.likes,
                comments: post.comments,
                shares: post.shares,
                engagement_rate: post.engagementRate,
                posted_at: post.postedAt,
                scraped_at: new Date().toISOString(),
              },
              { onConflict: "competitor_account_id,external_post_id", ignoreDuplicates: false },
            );

          if (insertErr) {
            errors.push({ companyId, handle: account.competitor_handle, message: insertErr.message });
          } else {
            postsProcessed++;
            metricsRecorded++;
          }
        }

        // Log estimated cost (Apify charges per compute unit; rough estimate)
        await svc.from("ins_external_provider_costs").insert({
          company_id: companyId,
          provider: "apify",
          operation: "competitor_scrape",
          external_run_id: result.runId,
          cost_usd: 0.005 * posts.length, // ~$0.005 per post scraped — refined once real costs known
          metadata: {
            actor_id: ACTOR_ID_FOR_PLATFORM(account.platform as string),
            handle: account.competitor_handle,
            posts_scraped: posts.length,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ companyId, handle: account.competitor_handle, message });
        logger.warn("ins.competitor-scrape.account_failed", {
          companyId,
          handle: account.competitor_handle,
          error: message,
        });
      }
    }
  }

  const durationMs = Date.now() - startMs;

  await svc.from("ins_ingest_log").insert({
    cron_route: "/api/cron/insights-competitor-scrape",
    company_id: null,
    posts_processed: postsProcessed,
    metrics_recorded: metricsRecorded,
    features_extracted: 0,
    errors: errors.length > 0 ? errors : [],
    duration_ms: durationMs,
  });

  logger.info("ins.competitor-scrape.complete", {
    companiesProcessed: companyIds.length,
    postsProcessed,
    metricsRecorded,
    errorCount: errors.length,
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    companiesProcessed: companyIds.length,
    postsProcessed,
    metricsRecorded,
    errorCount: errors.length,
  });
}

function ACTOR_ID_FOR_PLATFORM(platform: string): string {
  if (platform === "LINKEDIN") return process.env.APIFY_ACTOR_LINKEDIN ?? "anchor/linkedin-company-posts-scraper";
  if (platform === "FACEBOOK") return process.env.APIFY_ACTOR_FACEBOOK ?? "apify/facebook-pages-scraper";
  return "unknown";
}
