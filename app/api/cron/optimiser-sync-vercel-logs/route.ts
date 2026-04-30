import { type NextRequest } from "next/server";

import { syncVercelLogs } from "@/lib/optimiser/sync/vercel-logs";
import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";

// Daily Vercel logs → opt_metrics_daily sync (Phase 1.5 follow-up, slice D).
//
// Pulls the last 24 h of HTTP logs, attributes 5xx counts to managed
// landing pages, writes opt_metrics_daily rows with source='server_errors'.
// No-op + clean exit when VERCEL_API_TOKEN / VERCEL_PROJECT_ID are unset.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.vercel_logs_sync",
    run: async () => {
      const r = await syncVercelLogs();
      if (!r.ok) {
        return {
          outcomes: [],
          total: 0,
          meta: { ok: false, reason: r.reason, message: r.message },
        };
      }
      return {
        outcomes: [],
        total: r.rows_written,
        meta: {
          ok: true,
          pages_with_errors: r.pages_with_errors,
          total_5xx: r.total_5xx,
          total_requests: r.total_requests,
        },
      };
    },
  });
}

export const GET = handle;
export const POST = handle;
