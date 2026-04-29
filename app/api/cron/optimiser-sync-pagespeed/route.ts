import { type NextRequest } from "next/server";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  authorisedCronRequest,
  runOptimiserCronTick,
  unauthorisedResponse,
} from "@/lib/optimiser/sync/cron-shared";
import { syncPagespeedForClient } from "@/lib/optimiser/sync/pagespeed";
import { logger } from "@/lib/logger";

// PSI sync: weekly per landing page. PSI uses a single Opollo-wide API
// key (PAGESPEED_API_KEY) rather than per-client credentials, so this
// route iterates opt_clients directly rather than going through the
// credential-aware sync runner.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 299;

async function handle(req: NextRequest) {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();
  return runOptimiserCronTick({
    eventName: "optimiser.sync.pagespeed",
    run: async () => {
      const supabase = getServiceRoleClient();
      const { data, error } = await supabase
        .from("opt_clients")
        .select("id")
        .is("deleted_at", null);
      if (error) {
        throw new Error(`opt_clients fetch: ${error.message}`);
      }
      const outcomes: Array<{
        client_id: string;
        result: "ok" | "skipped" | "error";
        rows_written: number;
        error?: string;
      }> = [];
      for (const c of data ?? []) {
        const start = Date.now();
        try {
          const r = await syncPagespeedForClient(c.id as string);
          outcomes.push({
            client_id: c.id as string,
            result: r.skipped ? "skipped" : "ok",
            rows_written: r.rows_written,
          });
          void start;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          outcomes.push({
            client_id: c.id as string,
            result: "error",
            rows_written: 0,
            error: message,
          });
          logger.error("optimiser.sync.pagespeed.failed", {
            client_id: c.id,
            error: message,
          });
        }
      }
      return { outcomes, total: (data ?? []).length };
    },
  });
}

export const GET = handle;
export const POST = handle;
