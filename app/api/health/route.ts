import { NextResponse } from "next/server";

import {
  checkBudgetResetBacklog,
  checkSupabase,
} from "@/lib/health-checks";
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
//
// Probe functions live in @/lib/health-checks. Next.js 14 rejects
// arbitrary named exports from route.ts at build time; keeping the
// route file handler-only lets tests import the probes directly.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
