import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { logger } from "@/lib/logger";

// Shared cron-handler helpers for the optimiser sync routes. Mirrors
// the existing /api/cron/process-batch authorisation pattern; lives
// inside lib/optimiser so the route file at /api/cron/optimiser-sync-*
// is a thin wrapper.

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    const filler = Buffer.alloc(aBuf.length);
    timingSafeEqual(aBuf, filler);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function authorisedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

export function unauthorisedResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid cron secret.",
        retryable: false,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 401 },
  );
}

export async function runOptimiserCronTick(args: {
  /** Telemetry event name (e.g. 'optimiser.sync.ads'). */
  eventName: string;
  /** Run the source-specific fan-out — the runner returns the same
   * outcome shape regardless of source. */
  run: () => Promise<{ outcomes: unknown[]; total: number }>;
}): Promise<NextResponse> {
  try {
    const result = await args.run();
    logger.info(`${args.eventName}.tick`, {
      total: result.total,
      outcomes: result.outcomes,
    });
    return NextResponse.json(
      { ok: true, data: result, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${args.eventName}.failed`, { error: message });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: `${args.eventName} failed: ${message}`,
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
