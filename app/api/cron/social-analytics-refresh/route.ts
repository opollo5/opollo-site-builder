import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { refreshAnalyticsForAllProfiles } from "@/lib/platform/social/analytics-ingest";

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

  try {
    const result = await refreshAnalyticsForAllProfiles();
    logger.info("social.analytics.refresh.cron_ok", result);
    return NextResponse.json(
      { ok: true, data: result, timestamp: new Date().toISOString() },
      { status: result.profiles_failed > 0 ? 207 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("social.analytics.refresh.cron_failed", { err: message });
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
