import { type NextRequest } from "next/server";

import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { expireStaleProposals } from "@/lib/optimiser/proposals";

// Daily 08:00 UTC sweep of pending/approved proposals past their
// expires_at, flipping them to status='expired'. Idempotent.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.expire_proposals",
    run: async () => {
      const r = await expireStaleProposals();
      return { outcomes: [r], total: r.expired };
    },
  });
}

export const GET = handle;
export const POST = handle;
