import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  DEFAULT_LEASE_MS,
  leaseNextTransferItem,
  processTransferItemByJobType,
  reapExpiredLeases,
} from "@/lib/transfer-worker";

// ---------------------------------------------------------------------------
// GET/POST /api/cron/process-transfer — M4-2.
//
// Tick handler for the image-transfer worker. Mirrors the M3-3 cron
// entrypoint at app/api/cron/process-batch/route.ts. Each invocation:
//
//   1. Reap any expired leases (resets them to pending + bumps retry).
//   2. Lease the next available transfer_job_items row.
//   3. Process it (M4-2: dummy placeholder for cloudflare_ingest;
//      M4-3+: real Cloudflare upload; M4-4+: real Anthropic caption;
//      M4-7: wp_media_transfer variant).
//   4. Return.
//
// Capped at ONE item per tick — matches M3-3's reasoning. Vercel
// serverless functions have a 300s execution ceiling; serialising
// multiple items per invocation pushes toward it and also defeats the
// "concurrent workers processing disjoint items via SKIP LOCKED" model
// that scales horizontally.
//
// Not wired into vercel.json crons in this slice — M4-5 (iStock seed)
// and M4-7 (WP publish transfer) add the schedule when real work
// needs to flow. Until then the route is reachable on-demand via
// `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/process-
// transfer` for manual / CI-driven ticks.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 299s keeps us just under Vercel's 300s function ceiling — belt-
// and-suspenders for a stuck heartbeat loop.
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
  processedItemId: string | null;
}> {
  const { reapedCount } = await reapExpiredLeases();

  const workerId = `cron-transfer-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item = await leaseNextTransferItem(workerId, {
    leaseDurationMs: DEFAULT_LEASE_MS,
  });
  if (!item) {
    return { reapedCount, processedItemId: null };
  }

  // Dispatch by parent job type. cloudflare_ingest walks upload +
  // caption (M4-3 + M4-4); wp_media_transfer lands in M4-7.
  await processTransferItemByJobType(item.id, workerId);
  return { reapedCount, processedItemId: item.id };
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
          message: `Transfer tick failed: ${message}`,
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
