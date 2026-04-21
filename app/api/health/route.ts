import { NextResponse } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// GET /api/health — lightweight liveness + readiness probe.
//
// Liveness  : the process is alive and the handler returned.
// Readiness : Supabase is reachable (one-row SELECT against opollo_config,
//             which always has exactly one row — covers both connectivity
//             and the service-role key being valid).
//
// The endpoint returns 200 when both pass, 503 when readiness fails, and
// always includes:
//   - status: "ok" | "degraded"
//   - checks: { supabase: "ok" | "fail" }
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
      .select("id")
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

export async function GET(): Promise<NextResponse> {
  const supabase = await checkSupabase();

  const allOk = supabase.result === "ok";
  const body = {
    status: allOk ? "ok" : "degraded",
    checks: {
      supabase: supabase.result,
      supabase_latency_ms: supabase.latency_ms,
      ...(supabase.error ? { supabase_error: supabase.error } : {}),
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
