import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { runPublishWatchdog } from "@/lib/platform/social/publishing/watchdog";

// ---------------------------------------------------------------------------
// GET /api/cron/social-publish-watchdog
//
// Vercel cron (*/5 * * * *). Recovers social_publish_attempts that have
// been in_flight for >3 minutes without a webhook — marks them failed,
// advances master state to 'failed', and fires a post_failed notification.
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const result = await runPublishWatchdog();

  if (!result.ok) {
    logger.error("social.publish.watchdog.cron_failed", {
      err: result.error.message,
    });
    return NextResponse.json(
      { ok: false, error: result.error, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }

  logger.info("social.publish.watchdog.cron_ok", result.data);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
