import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { resetExpiredBudgets } from "@/lib/tenant-budgets";

// ---------------------------------------------------------------------------
// GET/POST /api/cron/budget-reset — M8-4.
//
// Hourly tick that zeros daily/monthly usage for any tenant_cost_budgets
// row whose reset timestamp is past. Advances the timestamp so the
// next tick is a no-op until the next rollover.
//
// Authentication: same Bearer CRON_SECRET pattern as process-batch +
// process-regenerations.
//
// Why hourly rather than daily-at-midnight? A missed midnight tick is
// a silent overdraw risk for the first hour of the next day. Hourly
// with the "only UPDATE rows where reset_at < now()" predicate makes
// each tick idempotent — catching up after a cron outage just works.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) {
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

  try {
    const result = await resetExpiredBudgets();
    return NextResponse.json(
      {
        ok: true,
        data: result,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: `Budget reset failed: ${message}`,
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
