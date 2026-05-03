import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { backfillScheduledPublishes } from "@/lib/platform/social/publishing";

// ---------------------------------------------------------------------------
// S1-19 — GET /api/cron/social-publish-backfill
//
// Vercel cron tick. Walks future-dated, non-cancelled
// social_schedule_entries with NULL qstash_message_id and re-enqueues
// them via QStash. Idempotent across reruns: a successful enqueue
// stamps qstash_message_id, so the next tick skips the row. The
// QStash deduplicationId on the publish itself guards against
// double-enqueue if two ticks race.
//
// No-op when QSTASH_TOKEN is unset (clean exit, status='skipped').
//
// Auth: shared CRON_SECRET bearer (lib/optimiser/sync/cron-shared).
// Vercel cron job adds the header automatically.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ??
    new URL(req.url).origin;

  const result = await backfillScheduledPublishes({ origin });
  if (!result.ok) {
    logger.error("social.publish.backfill.cron_failed", {
      err: result.error.message,
    });
    return NextResponse.json(
      {
        ok: false,
        error: result.error,
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  logger.info("social.publish.backfill.cron_ok", {
    status: result.data.status,
    ...(result.data.status === "ok"
      ? {
          examined: result.data.examined,
          enqueued: result.data.enqueued,
          failed: result.data.failed,
        }
      : { reason: result.data.reason }),
  });

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export const GET = handle;
export const POST = handle;
