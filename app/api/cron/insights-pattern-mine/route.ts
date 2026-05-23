import { NextResponse, type NextRequest } from "next/server";

import { authorisedCronRequest, unauthorisedResponse } from "@/lib/platform/cron/cron-shared";
import { minePatterns } from "@/lib/insights/pattern-miner";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Schedule: 0 6 * * 0 (weekly Sunday 06:00 UTC)

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const startMs = Date.now();

  try {
    const result = await minePatterns();

    logger.info("ins.pattern-mine.cron.complete", {
      ...result,
      durationMs: Date.now() - startMs,
    });

    return NextResponse.json({
      ok: true,
      companiesContributing: result.companiesContributing,
      postsContributing: result.postsContributing,
      patternsWritten: result.patternsWritten,
      durationMs: Date.now() - startMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("ins.pattern-mine.cron.error", { error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
