import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { dispatchWebhooks } from "@/lib/platform/social/publishing/dispatch-webhooks";

// ---------------------------------------------------------------------------
// GET /api/cron/dispatch-webhooks
//
// Vercel cron (every minute). Spec §2.3 specifies 30-second frequency but
// Vercel cron's minimum interval is 1 minute; documented in PR description.
//
// Claims up to 50 pending platform_event_deliveries, POSTs each to its
// subscriber's webhook_url with HMAC-SHA256 signature, and updates delivery
// status. Backoff schedule: 30 s, 5 min, 30 min, 2 h, 12 h; after 6 attempts
// the delivery is dead-lettered.
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const result = await dispatchWebhooks();

  if (!result.ok) {
    logger.error("dispatch_webhooks.cron_failed", { err: result.error.message });
    return NextResponse.json(
      { ok: false, error: result.error, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }

  logger.info("dispatch_webhooks.cron_ok", result.data);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
