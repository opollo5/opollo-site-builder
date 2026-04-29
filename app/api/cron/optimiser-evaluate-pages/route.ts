import { type NextRequest } from "next/server";

import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { runEvaluatePagesForAllClients } from "@/lib/optimiser/evaluate-pages-job";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.evaluate_pages",
    run: async () => {
      const r = await runEvaluatePagesForAllClients();
      return { outcomes: r.outcomes, total: r.total_pages };
    },
  });
}

export const GET = handle;
export const POST = handle;
