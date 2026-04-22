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
//
// Backlog   : tenant_cost_budgets rows whose daily_reset_at or
//             monthly_reset_at is more than 25h past. M8-4's reset cron
//             runs hourly and advances the reset timestamp; a row that
//             remains >25h past means the cron is stuck. Without this
//             check a stalled cron silently lets tenants overdraw their
//             daily caps for the full day until someone notices. Fulfils
//             the M8 parent-plan risk-mitigation claim; shipped in M11-7
//             after M11-6 retroactively (and incorrectly) claimed M11-3
//             had shipped it.
//
// The endpoint returns 200 when all checks pass, 503 when any readiness
// check fails, and always includes:
//   - status: "ok" | "degraded"
//   - checks: { supabase, budget_reset_backlog, ... }
//   - build:  { commit, env } — for correlating on-call incidents with
//             a deploy without opening the Vercel dashboard.
//
// Must remain public. Middleware allow-lists /api/health in
// PUBLIC_PATHS so monitors don't have to mint auth tokens.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckResult = "ok" | "fail";

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

// Tolerance window for the reset cron. The cron runs hourly; a healthy
// row should be at most ~1h past its reset timestamp before the next
// tick advances it. 25h gives two missed ticks of slack before we page
// (absorbs a single missed tick + clock skew) while still firing well
// inside the same-day window, before daily caps fully saturate.
const BACKLOG_THRESHOLD_HOURS = 25;
const BACKLOG_SAMPLE_LIMIT = 5;

export async function checkBudgetResetBacklog(): Promise<{
  result: CheckResult;
  count: number;
  sample: string[];
  latency_ms: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const supabase = getServiceRoleClient();
    // Index-backed: tenant_cost_budgets has an index on daily_reset_at
    // (migration 0012). Monthly column is unindexed but the row count
    // is bounded by sites × 1, so a full scan is cheap. LIMIT caps the
    // payload at BACKLOG_SAMPLE_LIMIT site_ids for the degraded-body
    // sample. The returned `count` is the sample length (bounded), which
    // is enough to distinguish "one stuck tenant" from "all of them" for
    // paging decisions; true cardinality can be queried via SQL when
    // on-call dives in.
    const thresholdMs = Date.now() - BACKLOG_THRESHOLD_HOURS * 3600_000;
    const threshold = new Date(thresholdMs).toISOString();
    const { data, error } = await supabase
      .from("tenant_cost_budgets")
      .select("site_id")
      .or(`daily_reset_at.lt.${threshold},monthly_reset_at.lt.${threshold}`)
      .limit(BACKLOG_SAMPLE_LIMIT);
    if (error) {
      return {
        result: "fail",
        count: 0,
        sample: [],
        latency_ms: Date.now() - start,
        error: error.message,
      };
    }
    const sample = (data ?? []).map((row) => row.site_id as string);
    return {
      result: sample.length === 0 ? "ok" : "fail",
      count: sample.length,
      sample,
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
  const [supabase, backlog] = await Promise.all([
    checkSupabase(),
    checkBudgetResetBacklog(),
  ]);

  const allOk = supabase.result === "ok" && backlog.result === "ok";
  const body = {
    status: allOk ? "ok" : "degraded",
    checks: {
      supabase: supabase.result,
      supabase_latency_ms: supabase.latency_ms,
      ...(supabase.error ? { supabase_error: supabase.error } : {}),
      budget_reset_backlog: backlog.result,
      budget_reset_backlog_count: backlog.count,
      budget_reset_backlog_sample: backlog.sample,
      budget_reset_backlog_latency_ms: backlog.latency_ms,
      ...(backlog.error ? { budget_reset_backlog_error: backlog.error } : {}),
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
