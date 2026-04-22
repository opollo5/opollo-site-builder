import { NextResponse } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/health — lightweight liveness + readiness probe.
//
// Liveness  : the process is alive and the handler returned.
// Readiness : Supabase is reachable — SELECT key FROM opollo_config
//             LIMIT 1 validates connectivity, service-role authz, and
//             schema presence. A zero-row result is still "ok"; we don't
//             depend on seeded data.
// Budget    : M11-3 — flags tenants whose daily/monthly reset_at is
//             more than 25h in the past. The M8-4 reset cron runs
//             hourly and advances reset_at on every fire; a stuck row
//             means the cron hasn't fired against it for at least
//             one full day. Without the probe, a silent cron failure
//             only surfaces when tenants start getting spurious
//             BUDGET_EXCEEDED once usage saturates.
//
// The endpoint returns 200 when every check passes, 503 when any
// check fails, and always includes:
//   - status: "ok" | "degraded"
//   - checks: { supabase, budget_reset_backlog_count, ... }
//   - build:  { commit, env } — for correlating on-call incidents
//             with a deploy without opening the Vercel dashboard.
//
// Must remain public. Middleware allow-lists /api/health in
// PUBLIC_PATHS so monitors don't have to mint auth tokens.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = "ok" | "fail";

// How far past the reset timestamp counts as "stuck". The reset cron
// runs hourly and advances the timestamp on every fire; 25h lets one
// missed tick slide before we page the on-call.
const BUDGET_RESET_STUCK_THRESHOLD_HOURS = 25;

// Cap the sample we return so a pathological "every tenant is stuck"
// case doesn't fan out into a huge response.
const BUDGET_RESET_SAMPLE_LIMIT = 5;

async function checkSupabase(): Promise<{ result: CheckResult; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const supabase = getServiceRoleClient();
    const { error } = await supabase
      .from("opollo_config")
      .select("key")
      .limit(1);
    if (error) {
      return { result: "fail", latency_ms: Date.now() - start, error: error.message };
    }
    return { result: "ok", latency_ms: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: "fail", latency_ms: Date.now() - start, error: message };
  }
}

type BudgetBacklogResult = {
  result: CheckResult;
  count: number;
  sample: string[];
  latency_ms: number;
  error?: string;
};

async function checkBudgetResetBacklog(): Promise<BudgetBacklogResult> {
  const start = Date.now();
  try {
    const supabase = getServiceRoleClient();
    const cutoffIso = new Date(
      Date.now() - BUDGET_RESET_STUCK_THRESHOLD_HOURS * 60 * 60 * 1000,
    ).toISOString();

    // Count every row where EITHER reset timestamp is stuck. Two
    // tenants can have the same row in backlog for different reasons
    // (daily vs monthly) — we don't double-count because count() here
    // is over rows, not over reset periods.
    const { count, error: countErr } = await supabase
      .from("tenant_cost_budgets")
      .select("site_id", { count: "exact", head: true })
      .or(
        `daily_reset_at.lt.${cutoffIso},monthly_reset_at.lt.${cutoffIso}`,
      );
    if (countErr) {
      return {
        result: "fail",
        count: 0,
        sample: [],
        latency_ms: Date.now() - start,
        error: countErr.message,
      };
    }

    const stuckCount = count ?? 0;
    if (stuckCount === 0) {
      return {
        result: "ok",
        count: 0,
        sample: [],
        latency_ms: Date.now() - start,
      };
    }

    // Cheap sample query — bounded by BUDGET_RESET_SAMPLE_LIMIT so the
    // response stays small even when thousands of tenants are stuck.
    const { data: sampleRows, error: sampleErr } = await supabase
      .from("tenant_cost_budgets")
      .select("site_id")
      .or(
        `daily_reset_at.lt.${cutoffIso},monthly_reset_at.lt.${cutoffIso}`,
      )
      .limit(BUDGET_RESET_SAMPLE_LIMIT);
    if (sampleErr) {
      return {
        result: "fail",
        count: stuckCount,
        sample: [],
        latency_ms: Date.now() - start,
        error: sampleErr.message,
      };
    }

    return {
      result: "fail",
      count: stuckCount,
      sample: (sampleRows ?? []).map((r) => r.site_id as string),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      result: "fail",
      count: 0,
      sample: [],
      latency_ms: Date.now() - start,
      error: message,
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const [supabase, budget] = await Promise.all([
    checkSupabase(),
    checkBudgetResetBacklog(),
  ]);

  const allOk = supabase.result === "ok" && budget.result === "ok";
  const body = {
    status: allOk ? "ok" : "degraded",
    checks: {
      supabase: supabase.result,
      supabase_latency_ms: supabase.latency_ms,
      ...(supabase.error ? { supabase_error: supabase.error } : {}),
      budget_reset_backlog: budget.result,
      budget_reset_backlog_count: budget.count,
      budget_reset_backlog_sample: budget.sample,
      budget_reset_backlog_latency_ms: budget.latency_ms,
      ...(budget.error ? { budget_reset_backlog_error: budget.error } : {}),
    },
    build: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    },
    timestamp: new Date().toISOString(),
  };

  if (!allOk) {
    // Readiness failure: log so Axiom picks it up once wired; otherwise
    // it silently surfaces as a 503 to the monitor.
    logger.warn("health.degraded", body);
  }

  return NextResponse.json(body, { status: allOk ? 200 : 503 });
}
