import { type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { planDigests, sendDigest } from "@/lib/optimiser/email/digests";
import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";

// Daily 09:00 UTC tick. planDigests decides which clients receive
// which digest today (Monday default + Thursday accelerated for
// critical; weekly+fortnightly Mondays for proposals).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.email.digest",
    run: async () => {
      const now = new Date();
      const decisions = await planDigests(now);
      const outcomes = [];
      for (const d of decisions) {
        const r = await sendDigest(d, now);
        outcomes.push(r);
        if (!r.ok) {
          logger.warn("optimiser.email.digest.send_failed", {
            client_id: d.client_id,
            kind: d.kind,
            error: r.error,
          });
        }
      }
      return { outcomes, total: decisions.length };
    },
  });
}

export const GET = handle;
export const POST = handle;
