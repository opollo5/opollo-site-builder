import { type NextRequest } from "next/server";

import { runAssistedApprovalSweep } from "@/lib/optimiser/assisted-approval";
import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";

// Hourly assisted-approval sweep — auto-approve low-risk proposals
// older than 48h for clients that opted in. Phase 2 Slice 21.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.assisted_approval",
    run: async () => {
      const r = await runAssistedApprovalSweep();
      return { outcomes: r.outcomes, total: r.total_auto_approved };
    },
  });
}

export const GET = handle;
export const POST = handle;
