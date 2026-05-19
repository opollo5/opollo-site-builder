import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { sendDailyCostReport } from "@/lib/platform/cost-monitoring/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const JOB_NAME = "cost-monitoring-daily-report";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  logger.info(`${JOB_NAME}.triggered`);

  try {
    const result = await sendDailyCostReport();
    await updateHeartbeat(JOB_NAME, "ok");
    logger.info(`${JOB_NAME}.complete`, { ...result });
    return NextResponse.json({ ok: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    await updateHeartbeat(JOB_NAME, "error", err);
    logger.error(`${JOB_NAME}.failed`, { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Cron failed", retryable: true },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
