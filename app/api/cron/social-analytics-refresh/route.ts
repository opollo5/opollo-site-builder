import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { refreshAnalyticsForAllProfiles } from "@/lib/platform/social/analytics-ingest";
import { getServiceRoleClient } from "@/lib/supabase";
import { recordHealthEvent } from "@/lib/platform/service-health/record";

// ---------------------------------------------------------------------------
// GET /api/cron/social-analytics-refresh
//
// Daily Vercel cron (04:00 UTC, one hour after social-connections-health
// at 03:00 UTC). Iterates every provisioned profile, refreshes account-
// and post-level analytics into the snapshot tables.
//
// No-op when BUNDLE_SOCIAL_API is unset.
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  if (!process.env.BUNDLE_SOCIAL_API) {
    logger.debug("social.analytics.refresh.cron: bundle.social not configured, skipping");
    return NextResponse.json(
      {
        ok: true,
        data: { status: "skipped", reason: "BUNDLE_SOCIAL_API not configured" },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  const ingestStartTime = Date.now();
  let ingestError: string | null = null;
  let result: Awaited<ReturnType<typeof refreshAnalyticsForAllProfiles>> | null = null;

  try {
    result = await refreshAnalyticsForAllProfiles();
    logger.info("social.analytics.refresh.cron_ok", result);
  } catch (err) {
    ingestError = err instanceof Error ? err.message : String(err);
    logger.error("social.analytics.refresh.cron_failed", { err: ingestError });
  } finally {
    const durationMs = Date.now() - ingestStartTime;
    const svc = getServiceRoleClient();
    await svc.from("ins_ingest_log").insert({
      cron_route: "/api/cron/social-analytics-refresh",
      company_id: null,
      posts_processed: 0,
      metrics_recorded: result?.profiles_refreshed ?? 0,
      features_extracted: 0,
      errors: ingestError ? [{ error: ingestError }] : [],
      duration_ms: durationMs,
    });

    if (ingestError) {
      await recordHealthEvent({
        serviceName: "insights",
        operation: "ingest_observed",
        eventType: "cron_stale",
        severity: "warning",
        details: { error: ingestError, durationMs },
      }).catch(() => undefined);
    }
  }

  if (ingestError) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: ingestError },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, data: result, timestamp: new Date().toISOString() },
    { status: (result?.profiles_failed ?? 0) > 0 ? 207 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
