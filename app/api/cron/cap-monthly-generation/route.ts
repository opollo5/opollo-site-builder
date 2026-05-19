import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat, guardedCronSkip } from "@/lib/platform/cron/cron-shared";
import { runMonthlyCapGeneration } from "@/lib/cap/monthly-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

const JOB_NAME = "cap-monthly-generation";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  const skip = guardedCronSkip(JOB_NAME);
  if (skip) return skip;

  logger.info(`${JOB_NAME}.triggered`);

  try {
    const result = await runMonthlyCapGeneration();
    await updateHeartbeat(JOB_NAME, "ok");
    logger.info(`${JOB_NAME}.complete`, { ...result });
    return NextResponse.json({ ok: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    await updateHeartbeat(JOB_NAME, "error", err);
    logger.error(`${JOB_NAME}.failed`, { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : "Cron failed", retryable: true }, timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
