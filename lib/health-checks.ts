import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Health-probe helpers. Each function returns a bounded, typed envelope the
// /api/health route aggregates into its response body. Lives in lib/ rather
// than in the route.ts file because Next.js 14 rejects arbitrary named
// exports from route handlers; lib/ has no such restriction, so tests can
// import these probes directly without build-time complaints.
// ---------------------------------------------------------------------------

export type CheckResult = "ok" | "fail";

export async function checkSupabase(): Promise<{
  result: CheckResult;
  latency_ms: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const supabase = getServiceRoleClient();
    const { error } = await supabase
      .from("opollo_config")
      .select("key")
      .limit(1);
    if (error) {
      return {
        result: "fail",
        latency_ms: Date.now() - start,
        error: error.message,
      };
    }
    return { result: "ok", latency_ms: Date.now() - start };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { result: "fail", latency_ms: Date.now() - start, error: message };
  }
}

// Tolerance window for the reset cron. The cron runs hourly; a healthy
// row should be at most ~1h past its reset timestamp before the next
// tick advances it. 25h gives two missed ticks of slack before we page
// (absorbs a single missed tick + clock skew) while still firing well
// inside the same-day window, before daily caps fully saturate.
export const BACKLOG_THRESHOLD_HOURS = 25;
export const BACKLOG_SAMPLE_LIMIT = 5;

export async function checkBudgetResetBacklog(): Promise<{
  result: CheckResult;
  count: number;
  sample: string[];
  latency_ms: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const supabase = getServiceRoleClient();
    // Index-backed: tenant_cost_budgets has an index on daily_reset_at
    // (migration 0012). Monthly column is unindexed but the row count
    // is bounded by sites × 1, so a full scan is cheap. LIMIT caps the
    // payload at BACKLOG_SAMPLE_LIMIT site_ids for the degraded-body
    // sample. The returned `count` is the sample length (bounded), which
    // is enough to distinguish "one stuck tenant" from "all of them" for
    // paging decisions; true cardinality can be queried via SQL when
    // on-call dives in.
    const thresholdMs = Date.now() - BACKLOG_THRESHOLD_HOURS * 3600_000;
    const threshold = new Date(thresholdMs).toISOString();
    const { data, error } = await supabase
      .from("tenant_cost_budgets")
      .select("site_id")
      .or(`daily_reset_at.lt.${threshold},monthly_reset_at.lt.${threshold}`)
      .limit(BACKLOG_SAMPLE_LIMIT);
    if (error) {
      return {
        result: "fail",
        count: 0,
        sample: [],
        latency_ms: Date.now() - start,
        error: error.message,
      };
    }
    const sample = (data ?? []).map((row) => row.site_id as string);
    return {
      result: sample.length === 0 ? "ok" : "fail",
      count: sample.length,
      sample,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      result: "fail",
      count: 0,
      sample: [],
      latency_ms: Date.now() - start,
      error: message,
    };
  }
}
