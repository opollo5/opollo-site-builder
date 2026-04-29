import { type NextRequest } from "next/server";

import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { runEvaluateScoresForAllClients } from "@/lib/optimiser/scoring/evaluate-scores-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.evaluate_scores",
    run: async () => {
      const r = await runEvaluateScoresForAllClients();
      return { outcomes: r.outcomes, total: r.total_pages };
    },
  });
}

export const GET = handle;
export const POST = handle;
