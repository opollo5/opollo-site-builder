import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { fetchRolloutMetrics } from "@/lib/optimiser/staged-rollout/metrics";
import {
  evaluateRollout,
  listLiveRollouts,
  recordEvaluation,
  transitionToTerminal,
} from "@/lib/optimiser/staged-rollout/manager";

// OPTIMISER PHASE 1.5 SLICE 16 — Hourly cron handler for staged
// rollout monitoring. Vercel Cron pings this with
// `Authorization: Bearer $CRON_SECRET` per the project's standard
// cron auth pattern.
//
// Per tick:
//   1. Pull every live rollout (ordered by oldest-started-first).
//   2. For each: fetch metrics, evaluate against config_snapshot,
//      append to regression_check_results, transition state if the
//      decision is terminal.
//   3. window_expired → promote with a warning logged. The page has
//      too little traffic for staged rollout to be meaningful;
//      better to ship than block forever.
//
// Slice 16 deliberately does NOT call out to a traffic-splitter API
// to actually flip the split / revert. That mechanism is a follow-up
// sub-slice. The decisions ARE recorded — operators can act on them
// manually until the splitter integration lands.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

interface TickSummary {
  evaluated: number;
  promoted: number;
  reverted: number;
  window_expired: number;
  waited: number;
}

async function runTick(): Promise<TickSummary> {
  const summary: TickSummary = {
    evaluated: 0,
    promoted: 0,
    reverted: 0,
    window_expired: 0,
    waited: 0,
  };
  const rollouts = await listLiveRollouts();
  const now = new Date();

  for (const rollout of rollouts) {
    summary.evaluated += 1;
    try {
      const metrics = await fetchRolloutMetrics({
        landing_page_id: rollout.page_id,
        rollout_started_at: rollout.started_at,
        now,
      });
      const evaluation = evaluateRollout({
        config: rollout.config_snapshot,
        metrics,
        age_ms: now.getTime() - new Date(rollout.started_at).getTime(),
      });
      await recordEvaluation(rollout.id, evaluation, metrics);

      switch (evaluation.decision) {
        case "rollback":
          await transitionToTerminal(
            rollout.id,
            "auto_reverted",
            evaluation.trips[0] ?? "rollback_threshold_tripped",
          );
          summary.reverted += 1;
          break;
        case "promote":
          await transitionToTerminal(
            rollout.id,
            "promoted",
            "floors_met_thresholds_clear",
          );
          summary.promoted += 1;
          break;
        case "window_expired":
          logger.warn("staged-rollout: promoting after window expiry", {
            rollout_id: rollout.id,
            proposal_id: rollout.proposal_id,
            sessions: metrics.sessions_new,
            conversions: metrics.conversions_new,
          });
          await transitionToTerminal(
            rollout.id,
            "promoted",
            "window_expired_promoted_with_warning",
          );
          summary.window_expired += 1;
          break;
        case "wait":
          summary.waited += 1;
          break;
      }
    } catch (err) {
      logger.error("staged-rollout: monitor tick failed for rollout", {
        rollout_id: rollout.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorised(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid cron secret.",
        },
      },
      { status: 401 },
    );
  }
  try {
    const summary = await runTick();
    return NextResponse.json({ ok: true, data: summary });
  } catch (err) {
    logger.error("cron.optimiser_monitor_rollouts.failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
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
