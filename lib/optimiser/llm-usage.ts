import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// LLM usage tracking + budget enforcement (spec §4.6).
//
//   - Every LLM call goes through `recordLlmCall` which inserts a row
//     in opt_llm_usage. Daily / monthly rollups are SUM() over this
//     table (indexed by client_id + created_at).
//
//   - `checkBudget(client_id)` returns the current month's rolled
//     spend in micros + the soft / hard threshold flags. Slice 5
//     callers gate every LLM call on this; pre-call rejections still
//     record an `outcome = 'budget_exceeded'` row so the budget
//     surface shows what would have been spent.
//
//   - The 75% / 100% boundaries follow §4.6: soft warning at 0.75,
//     hard cutoff at 1.00 of opt_clients.llm_monthly_budget_usd.
// ---------------------------------------------------------------------------

const MICROS_PER_USD = 1_000_000;

export type BudgetCheckResult = {
  /** Configured monthly budget in micros (0 if not set). */
  budgetMicros: number;
  /** Spend this calendar month in micros from opt_llm_usage WHERE outcome = 'ok'. */
  spendMicros: number;
  /** Fraction of budget consumed; capped at 9.9999 if budget = 0 (treated as no-budget). */
  fraction: number;
  /** TRUE once spend has crossed 75%. */
  warning: boolean;
  /** TRUE once spend has crossed 100% — every gated call must short-circuit. */
  exceeded: boolean;
};

export async function checkBudget(clientId: string): Promise<BudgetCheckResult> {
  const supabase = getServiceRoleClient();

  const { data: client, error: clientErr } = await supabase
    .from("opt_clients")
    .select("llm_monthly_budget_usd")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    throw new Error(`checkBudget: ${clientErr.message}`);
  }
  const budgetUsd = client?.llm_monthly_budget_usd ?? 0;
  const budgetMicros = budgetUsd * MICROS_PER_USD;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // Sum is computed in JS rather than via an RPC because Phase 1 row
  // counts are bounded (one row per LLM call, ~ tens per client per
  // day). When this becomes hot, swap to a SQL function.
  const { data: rows, error: usageErr } = await supabase
    .from("opt_llm_usage")
    .select("cost_usd_micros")
    .eq("client_id", clientId)
    .eq("outcome", "ok")
    .gte("created_at", monthStart.toISOString());
  if (usageErr) {
    throw new Error(`checkBudget: ${usageErr.message}`);
  }
  const spendMicros = (rows ?? []).reduce(
    (acc, r) => acc + (r.cost_usd_micros as number),
    0,
  );

  if (budgetMicros === 0) {
    return {
      budgetMicros,
      spendMicros,
      fraction: spendMicros > 0 ? 9.9999 : 0,
      warning: false,
      exceeded: false,
    };
  }
  const fraction = spendMicros / budgetMicros;
  return {
    budgetMicros,
    spendMicros,
    fraction,
    warning: fraction >= 0.75,
    exceeded: fraction >= 1.0,
  };
}

export type RecordLlmCallArgs = {
  clientId: string;
  caller: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costUsdMicros: number;
  sourceTable?: string;
  sourceId?: string;
  requestId?: string;
  anthropicRequestId?: string;
  outcome?: "ok" | "budget_exceeded" | "error";
  errorCode?: string;
};

export async function recordLlmCall(
  args: RecordLlmCallArgs,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase.from("opt_llm_usage").insert({
    client_id: args.clientId,
    caller: args.caller,
    model: args.model,
    input_tokens: Math.max(0, Math.round(args.inputTokens)),
    output_tokens: Math.max(0, Math.round(args.outputTokens)),
    cached_tokens: Math.max(0, Math.round(args.cachedTokens ?? 0)),
    cost_usd_micros: Math.max(0, Math.round(args.costUsdMicros)),
    source_table: args.sourceTable ?? null,
    source_id: args.sourceId ?? null,
    request_id: args.requestId ?? null,
    anthropic_request_id: args.anthropicRequestId ?? null,
    outcome: args.outcome ?? "ok",
    error_code: args.errorCode ?? null,
  });
  if (error) {
    logger.error("optimiser.llm_usage.insert_failed", {
      client_id: args.clientId,
      caller: args.caller,
      error: error.message,
    });
  }
}

/**
 * Convenience: gate an LLM call on budget. Returns 'allow' | 'warn' |
 * 'block'; on 'block' a budget_exceeded row is recorded and the caller
 * must short-circuit. On 'warn' the call proceeds; staff see the
 * banner from the dashboard which reads opt_clients + checkBudget
 * directly.
 */
export async function gateLlmCall(
  clientId: string,
  caller: string,
  expectedCostMicros = 0,
): Promise<"allow" | "warn" | "block"> {
  const { exceeded, warning } = await checkBudget(clientId);
  if (exceeded) {
    await recordLlmCall({
      clientId,
      caller,
      model: "n/a",
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: expectedCostMicros,
      outcome: "budget_exceeded",
      errorCode: "BUDGET_EXCEEDED",
    });
    return "block";
  }
  return warning ? "warn" : "allow";
}
