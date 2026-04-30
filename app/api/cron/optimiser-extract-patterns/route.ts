import { type NextRequest } from "next/server";

import { runPatternExtraction } from "@/lib/optimiser/pattern-library/extractor";
import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";

// Daily cross-client pattern extraction (Phase 3 Slice 22, spec §11.2).
// Gated on OPT_PATTERN_LIBRARY_ENABLED feature flag + per-client
// cross_client_learning_consent. Cron returns cleanly when the flag is
// off — no DB writes.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.pattern_extraction",
    run: async () => {
      const r = await runPatternExtraction();
      return {
        outcomes: r.outcomes,
        total: r.patterns_upserted,
        meta: {
          enabled: r.enabled,
          consenting_clients: r.consenting_clients,
          observations_total: r.observations_total,
        },
      };
    },
  });
}

export const GET = handle;
export const POST = handle;
