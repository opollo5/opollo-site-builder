import { type NextRequest } from "next/server";

import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { runSyncForAllClients } from "@/lib/optimiser/sync/runner";
import { syncGa4ForClient } from "@/lib/optimiser/sync/ga4";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.sync.ga4",
    run: () => runSyncForAllClients("ga4", syncGa4ForClient),
  });
}

export const GET = handle;
export const POST = handle;
