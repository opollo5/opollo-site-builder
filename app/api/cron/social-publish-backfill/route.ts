import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import {
  authorisedCronRequest,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";

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

  // V1 backfill cron retired (pr-12 removed vercel.json schedule entry;
  // pr-13 retired the V1 QStash pipeline). Route kept alive to avoid 404s
  // from any in-flight triggers. Returns 200 noop.
  logger.warn("social.publish.backfill.v1_retired", {
    note: "V1 backfill cron retired — route is a noop; vercel.json entry removed in pr-12",
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
