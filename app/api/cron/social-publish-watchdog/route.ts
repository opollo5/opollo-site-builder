import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";

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

  // V1 watchdog cron retired (pr-12 removed vercel.json schedule entry;
  // pr-13 retired the V1 QStash pipeline). Route kept alive to avoid 404s
  // from any in-flight triggers. Returns 200 noop.
  logger.warn("social.publish.watchdog.v1_retired", {
    note: "V1 watchdog cron retired — route is a noop; vercel.json entry removed in pr-12",
  });
  return NextResponse.json(
    {
      ok: true,
      data: { status: "retired", reason: "V1 QStash pipeline retired (pr-13)" },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
