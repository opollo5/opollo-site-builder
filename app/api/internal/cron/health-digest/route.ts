import { NextResponse, type NextRequest } from "next/server";

import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { sendDailyDigest } from "@/lib/platform/service-health/digest";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// POST /api/internal/cron/health-digest
// Schedule: 0 23 * * * UTC (= 9am AEST daily)
//
// Sends the daily service health digest email to all platform admins.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  try {
    const result = await sendDailyDigest();
    await updateHeartbeat("health-digest", "ok");
    logger.info("health_digest.done", result);
    return NextResponse.json({ ok: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("health_digest.failed", { err: err instanceof Error ? err.message : String(err) });
    await updateHeartbeat("health-digest", "error", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
