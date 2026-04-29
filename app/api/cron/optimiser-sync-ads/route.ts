import { type NextRequest } from "next/server";

import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { runSyncForAllClients } from "@/lib/optimiser/sync/runner";
import { syncAdsForClient } from "@/lib/optimiser/sync/ads";

// Daily Google Ads sync. Vercel cron schedule: see vercel.json. Uses
// the standard CRON_SECRET Bearer auth; 401 if missing or wrong.
//
// One tick fans out across every client with status='connected' Ads
// credentials. Each per-client sync short-circuits if it ran within
// the last hour, so daily-cadence is enforced even if the cron runs
// hourly.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.sync.ads",
    run: () => runSyncForAllClients("google_ads", syncAdsForClient),
  });
}

export const GET = handle;
export const POST = handle;
