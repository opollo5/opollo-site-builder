import { type NextRequest } from "next/server";

import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { runCausalDeltaEvaluationForAllClients } from "@/lib/optimiser/causal/evaluate-deltas";

// Daily post-rollout evaluation at 08:15 UTC. For every applied
// proposal where the rollout window has closed, computes actual_impact
// and writes/updates a row in opt_causal_deltas.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.evaluate_causal_deltas",
    run: async () => {
      const r = await runCausalDeltaEvaluationForAllClients();
      return { outcomes: r.outcomes, total: r.total_proposals };
    },
  });
}

export const GET = handle;
export const POST = handle;
