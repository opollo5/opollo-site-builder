import { type NextRequest } from "next/server";

import { runAbMonitorTick } from "@/lib/optimiser/ab-testing/monitor";
import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";

// Hourly Bayesian winner-detection monitor for active A/B tests
// (Phase 2 Slice 19). Spec §6 feature 8.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.ab.monitor",
    run: async () => {
      const r = await runAbMonitorTick();
      return { outcomes: r.outcomes, total: r.total_running };
    },
  });
}

export const GET = handle;
export const POST = handle;
