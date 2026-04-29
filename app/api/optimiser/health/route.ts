import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { checkOptimiserSchema } from "@/lib/optimiser/health";

// ---------------------------------------------------------------------------
// GET /api/optimiser/health
//
// Module-specific liveness probe. Distinct from /api/health (which is the
// app-wide probe used by external monitors) — this one is intended for
// internal staff dashboards and confirms the optimiser schema is reachable.
// Sits behind the standard auth middleware; no Bearer secret carve-out.
//
// Shape mirrors /api/health for parity:
//   - status: "ok" | "degraded"
//   - checks: { schema, schema_latency_ms, schema_error? }
//   - module / build for correlating with deploy state
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const schema = await checkOptimiserSchema();
    const allOk = schema.result === "ok";
    const body = {
      status: allOk ? "ok" : "degraded",
      module: "optimiser",
      checks: {
        schema: schema.result,
        schema_latency_ms: schema.latency_ms,
        ...(schema.error ? { schema_error: schema.error } : {}),
      },
      build: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
        env: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
      },
      timestamp: new Date().toISOString(),
    };

    if (!allOk) {
      logger.warn("optimiser.health.degraded", body);
    }

    return NextResponse.json(body, { status: allOk ? 200 : 503 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("optimiser.health.probe_threw", { error: message });
    return NextResponse.json(
      {
        status: "degraded",
        module: "optimiser",
        checks: { probe_error: message },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
