import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  dummyAnthropicCall,
  dummyVisualRender,
} from "@/lib/brief-runner-dummy";
import {
  processBriefRunTick,
  reapExpiredBriefRuns,
  type BriefRunTickResult,
} from "@/lib/brief-runner";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET/POST /api/cron/process-brief-runner — M12-6.
//
// Mirrors the M3-3 process-batch cron shape for the brief-driven runner.
// One tick per invocation:
//
//   1. Reap any expired brief_run leases (resets them to 'queued').
//   2. Pick the oldest queued brief_run (FOR UPDATE SKIP LOCKED is
//      handled inside processBriefRunTick's leaseBriefRun).
//   3. Tick it — processBriefRunTick leases, runs ONE step, and
//      returns. A single tick may:
//        - Run a full page's text + visual passes end-to-end (if the
//          page ran cleanly with no crash), landing it in
//          awaiting_review.
//        - Advance from a resumed mid-state to awaiting_review.
//        - Do nothing (already at awaiting_review, lease stolen, etc.)
//      Multi-page runs need multiple ticks — one page per tick.
//   4. Return.
//
// Authentication: same Bearer CRON_SECRET pattern as the batch cron.
// Production wires this to a Vercel cron schedule (see vercel.json).
// E2E test driver calls it with the same Bearer token to drive ticks
// from a Playwright spec.
//
// Anthropic routing: real call when ANTHROPIC_API_KEY is set;
// deterministic stub otherwise. This matches process-batch and keeps
// preview + E2E environments exercising the full state machine.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cap at 299s to stay under Vercel's 300s serverless ceiling. A single
// tick typically completes in under 30s (one page's text + visual
// passes); the ceiling is belt-and-suspenders for a stuck heartbeat.
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

type TickResult = {
  reapedCount: number;
  processedRunId: string | null;
  outcome: string | null;
};

async function runTick(): Promise<TickResult> {
  const svc = getServiceRoleClient();

  // Step 1: reap any expired leases so a crashed worker's row is
  // re-queued and can be leased below.
  const dbUrl = process.env.SUPABASE_DB_URL;
  let reapedCount = 0;
  if (dbUrl) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const reaped = await reapExpiredBriefRuns(client);
      reapedCount = reaped.reapedCount;
    } finally {
      await client.end();
    }
  }

  // Step 2: pick the oldest queued run. Service-role read; concurrency
  // is handled inside leaseBriefRun (SELECT … FOR UPDATE SKIP LOCKED).
  const next = await svc
    .from("brief_runs")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (next.error) {
    logger.error("cron.brief_runner.next_lookup_failed", {
      error: next.error,
    });
    return { reapedCount, processedRunId: null, outcome: null };
  }
  if (!next.data) {
    return { reapedCount, processedRunId: null, outcome: "nothing_queued" };
  }
  const runId = next.data.id as string;

  // Step 3: tick. Route to real Anthropic when the key is set,
  // otherwise use the deterministic stubs. Same pattern as
  // process-batch.
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const result: BriefRunTickResult = await processBriefRunTick(runId, {
    workerId: `cron-brief-${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...(hasKey
      ? {}
      : {
          anthropicCall: dummyAnthropicCall,
          visualRender: dummyVisualRender,
        }),
  });

  return {
    reapedCount,
    processedRunId: runId,
    outcome: result.ok ? result.outcome : result.code,
  };
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
    logger.error("cron.brief_runner.tick_failed", { error: message });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: `Brief-runner cron tick failed: ${message}`,
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
