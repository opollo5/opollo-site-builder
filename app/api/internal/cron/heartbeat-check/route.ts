import { NextResponse, type NextRequest } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase";
import { authorisedCronRequest, unauthorisedResponse, updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { recordHealthEvent } from "@/lib/platform/service-health/record";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Heartbeat staleness threshold: each job must have run within 2× its schedule.
//
// Adding a new cron? Put its threshold here. The default fallback (30 min) is
// wrong for anything other than a sub-30-min schedule — daily / weekly /
// monthly crons trip the default constantly and create FALSE_POSITIVE
// cron_stale rows. The dedup in record.ts now latches those to a single row
// per cron, but the right fix is still to set the correct threshold.
const STALENESS_THRESHOLDS: Record<string, number> = {
  "publish-due":                  2 * 60 * 1000,            // 2 min (runs every 1 min)
  "heartbeat-check":              15 * 60 * 1000,           // 15 min (runs every 5 min)
  "health-check":                 15 * 60 * 1000,           // 15 min
  "cleanup-cache":                26 * 60 * 60 * 1000,      // 26h (runs daily)
  "escalate-approvals":           8 * 60 * 60 * 1000,       // 8h (runs every 6h)
  "health-digest":                26 * 60 * 60 * 1000,      // 26h (runs daily)
  "cap-generation-runs-cleanup":  26 * 60 * 60 * 1000,      // 26h (runs daily at 02:00)
  "cap-monthly-generation":       32 * 24 * 60 * 60 * 1000, // 32 days (runs 1st of month at 04:00)
  "cap-weekly-generation":        8 * 24 * 60 * 60 * 1000,  // 8 days (runs Mondays at 06:00)
  "cost-monitoring-daily-report": 26 * 60 * 60 * 1000,      // 26h (runs daily at 07:00)
};

// ---------------------------------------------------------------------------
// POST /api/internal/cron/heartbeat-check
// Schedule: */5 * * * *
//
// Finds stale cron heartbeats and records cron_stale health events.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleCron(req);
}

async function handleCron(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const svc = getServiceRoleClient();
  const now = Date.now();

  const { data: heartbeats, error } = await svc
    .from("cron_heartbeats")
    .select("job_name, last_run_at, last_status");

  if (error) {
    logger.error("heartbeat_check.query_failed", { err: error.message });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let staleCount = 0;

  for (const hb of heartbeats ?? []) {
    const jobName = hb.job_name as string;
    const lastRunAt = hb.last_run_at ? new Date(hb.last_run_at as string).getTime() : 0;
    const threshold = STALENESS_THRESHOLDS[jobName] ?? 30 * 60 * 1000;

    if (now - lastRunAt > threshold) {
      staleCount++;
      void recordHealthEvent({
        serviceName: "cron",
        operation: jobName,
        eventType: "cron_stale",
        severity: "warning",
        details: { jobName, last_run_at: hb.last_run_at, threshold_ms: threshold },
      });
      logger.warn("heartbeat_check.stale", { jobName, last_run_at: hb.last_run_at });
    }
  }

  await updateHeartbeat("heartbeat-check", "ok");

  return NextResponse.json({
    ok: true,
    data: { checked: (heartbeats ?? []).length, stale: staleCount },
    timestamp: new Date().toISOString(),
  });
}
