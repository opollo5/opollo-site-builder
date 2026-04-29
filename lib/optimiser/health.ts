import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// Optimiser-module health probes. Mirrors lib/health-checks.ts.

export type ProbeResult = {
  result: "ok" | "fail";
  latency_ms: number;
  error?: string;
};

/**
 * Probe the optimiser schema. A trivial SELECT against opt_clients
 * validates connectivity, service-role auth, and that the Slice 1
 * migrations have applied. A zero-row result is still "ok" — we
 * don't depend on seeded clients.
 */
export async function checkOptimiserSchema(): Promise<
  ProbeResult & { count?: number | null }
> {
  const start = Date.now();
  try {
    const supabase = getServiceRoleClient();
    const { error, count } = await supabase
      .from("opt_clients")
      .select("id", { count: "exact", head: true });
    const latency_ms = Date.now() - start;
    if (error) {
      return { result: "fail", latency_ms, error: error.message };
    }
    return { result: "ok", latency_ms, count: count ?? null };
  } catch (err) {
    const latency_ms = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return { result: "fail", latency_ms, error: message };
  }
}
