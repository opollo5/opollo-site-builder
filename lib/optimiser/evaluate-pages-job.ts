import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { computeReliability } from "./data-reliability";
import { evaluateAndPersistPage } from "./healthy-state";
import { rollupForPage } from "./metrics-aggregation";

// ---------------------------------------------------------------------------
// Daily page-state evaluation job. Iterates every managed landing page
// across all clients, computes the rollup + reliability + healthy state,
// persists the result, and emits a change-log row on any state change.
//
// Bounded by client; per-client failure isolated. Phase 1 doesn't yet
// have alignment scores or playbook trigger evaluation (Slice 5), so
// every healthy criterion that depends on those returns "passed=false"
// or "skip", and most pages stay at `active` until Slice 5 enriches
// the inputs. The daily job is wired now so Slice 5 can drop alignment +
// playbook triggers into the same evaluation pass.
// ---------------------------------------------------------------------------

export type EvaluatePagesOutcome = {
  client_id: string;
  pages_evaluated: number;
  pages_changed_state: number;
  errors: number;
};

export async function runEvaluatePagesForAllClients(): Promise<{
  outcomes: EvaluatePagesOutcome[];
  total_pages: number;
}> {
  const supabase = getServiceRoleClient();
  const { data: clients, error } = await supabase
    .from("opt_clients")
    .select("id")
    .is("deleted_at", null);
  if (error) {
    throw new Error(`runEvaluatePagesForAllClients: ${error.message}`);
  }

  const outcomes: EvaluatePagesOutcome[] = [];
  let total_pages = 0;
  for (const client of clients ?? []) {
    const o = await runForClient(client.id as string);
    total_pages += o.pages_evaluated;
    outcomes.push(o);
  }
  return { outcomes, total_pages };
}

async function runForClient(clientId: string): Promise<EvaluatePagesOutcome> {
  const supabase = getServiceRoleClient();
  const { data: pages, error } = await supabase
    .from("opt_landing_pages")
    .select("id, management_mode")
    .eq("client_id", clientId)
    .eq("managed", true)
    .is("deleted_at", null);
  if (error) {
    logger.error("optimiser.evaluate_pages.list_failed", {
      client_id: clientId,
      error: error.message,
    });
    return {
      client_id: clientId,
      pages_evaluated: 0,
      pages_changed_state: 0,
      errors: 1,
    };
  }

  // Compute the active-pages CR average for the ±20% band check.
  // Phase 1 takes the simple SUM(conv) / SUM(sessions) over the last
  // 30 days for state='active' pages; once a page has lots of zero
  // sessions, it drops out of the average. Slice 5 may swap to a
  // weighted average per playbook calibration; the contract is the
  // same: a single number representing "what good looks like".
  const clientAvgCr = await computeClientActiveAvgCr(clientId);

  let evaluated = 0;
  let changed = 0;
  let errs = 0;

  for (const page of pages ?? []) {
    try {
      const rollup = await rollupForPage(page.id as string);
      const reliability = computeReliability(rollup);
      const result = await evaluateAndPersistPage({
        landingPageId: page.id as string,
        clientId,
        managementMode: page.management_mode as "read_only" | "full_automation",
        rollup,
        reliability,
        clientActiveAvgCr: clientAvgCr,
      });
      evaluated += 1;
      if (result.state === "healthy") {
        // No-op; the persistEvaluation helper writes a change-log row
        // already on transition.
      }
      // We don't recount changed here — persistEvaluation tracks it
      // internally. Instead, count `changed` as "any non-default state"
      // for the rollup metric.
      if (result.state !== "active") {
        changed += 1;
      }
    } catch (err) {
      errs += 1;
      logger.error("optimiser.evaluate_pages.failed", {
        client_id: clientId,
        landing_page_id: page.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    client_id: clientId,
    pages_evaluated: evaluated,
    pages_changed_state: changed,
    errors: errs,
  };
}

async function computeClientActiveAvgCr(
  clientId: string,
): Promise<number | null> {
  const supabase = getServiceRoleClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const { data, error } = await supabase
    .from("opt_metrics_daily")
    .select("metrics")
    .eq("client_id", clientId)
    .eq("source", "ga4")
    .gte("metric_date", since.toISOString().slice(0, 10));
  if (error || !data || data.length === 0) return null;
  let sessions = 0;
  let conversions = 0;
  for (const r of data) {
    const m = (r.metrics ?? {}) as { sessions?: number; conversions?: number };
    sessions += m.sessions ?? 0;
    conversions += m.conversions ?? 0;
  }
  if (sessions === 0) return null;
  return conversions / sessions;
}
