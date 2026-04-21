import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  DEFAULT_LEASE_MS,
  leaseNextPage,
  processSlotAnthropic,
  processSlotDummy,
  reapExpiredLeases,
} from "@/lib/batch-worker";

// ---------------------------------------------------------------------------
// GET/POST /api/cron/process-batch — M3-3.
//
// Entrypoint the Vercel cron tick (and on-demand `waitUntil` from the
// creator endpoint in a future slice) calls to do one "tick" of batch
// work:
//
//   1. Reap any expired leases (resets them to pending).
//   2. Lease the next available slot.
//   3. Process it (M3-3: dummy placeholder; M3-4+: real Anthropic + WP).
//   4. Return.
//
// We cap each invocation at ONE slot on purpose. Vercel serverless
// functions have a 300s execution ceiling; processing many slots in
// one invocation pushes toward the ceiling and also serializes work
// that should be concurrent. Multiple concurrent cron invocations
// (one per slot) lease disjoint rows via SKIP LOCKED and finish in
// parallel.
//
// Authentication: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
// when CRON_SECRET is configured on the project. Constant-time
// comparison against the env var; otherwise 401. GET is accepted
// because Vercel's cron uses GET by default; POST accepted for
// symmetry with the future on-demand invocation path.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 299s keeps us just under Vercel's 300s function ceiling. In practice
// one tick processes one slot and returns in well under a minute; the
// cap here is belt-and-suspenders for a stuck heartbeat loop.
export const maxDuration = 299;

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

async function runTick(): Promise<{
  reapedCount: number;
  processedSlotId: string | null;
}> {
  const { reapedCount } = await reapExpiredLeases();

  const workerId = `cron-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slot = await leaseNextPage(workerId, {
    leaseDurationMs: DEFAULT_LEASE_MS,
  });
  if (!slot) {
    return { reapedCount, processedSlotId: null };
  }

  // Route to the real Anthropic path when ANTHROPIC_API_KEY is set;
  // otherwise run the M3-3 dummy processor. Tests + previews without
  // an API key still exercise the full concurrency loop via dummy,
  // which is what kept M3-3 from being a dead branch once real
  // calls arrived.
  if (process.env.ANTHROPIC_API_KEY) {
    await processSlotAnthropic(slot.id, workerId);
  } else {
    await processSlotDummy(slot.id, workerId);
  }
  return { reapedCount, processedSlotId: slot.id };
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
    const result = await runTick();
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
          message: `Cron tick failed: ${message}`,
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
