import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { TestRow, VariantRow } from "./types";

// ---------------------------------------------------------------------------
// Test activation (Slice 18). Once both variants reach status='ready'
// (the brief-runner has generated + written the static files), the
// activator:
//
//   1. Confirms both variants are ready.
//   2. Flips opt_variants.status to 'active' for both.
//   3. Flips the opt_tests row to 'running' with started_at = now().
//
// The traffic-split <script> injection happens on each static-file
// write per the brief-runner integration in Phase 1.5; the script
// content is built from the activator's output via
// lib/optimiser/variants/traffic-split.ts:buildTrafficSplitScript.
// Slice 18 ships the activator + script builder. The actual
// integration point on the brief-runner write step lands when the
// optimiser-runner-bridge ships in Slice 19's monitor work — for now
// the static files exist with traffic_split=null and the script is
// re-injected by the next monitor tick.
//
// activate() is idempotent: re-running on an already-running test
// returns ok=true without side effects.
// ---------------------------------------------------------------------------

export type ActivateTestResult =
  | { ok: true; test: TestRow; variant_a: VariantRow; variant_b: VariantRow }
  | {
      ok: false;
      error: { code: "NOT_FOUND" | "VARIANTS_NOT_READY" | "ALREADY_ENDED" | "INTERNAL"; message: string };
    };

export async function activateTest(testId: string): Promise<ActivateTestResult> {
  const supabase = getServiceRoleClient();
  const { data: test, error: testErr } = await supabase
    .from("opt_tests")
    .select(
      "id, client_id, landing_page_id, source_proposal_id, variant_a_id, variant_b_id, traffic_split_percent, status, min_sessions, min_conversions, winner_probability_a, winner_probability_b, last_metrics_snapshot, last_evaluated_at, started_at, ended_at, ended_reason, created_at, updated_at",
    )
    .eq("id", testId)
    .maybeSingle();
  if (testErr) {
    return { ok: false, error: { code: "INTERNAL", message: testErr.message } };
  }
  if (!test) {
    return { ok: false, error: { code: "NOT_FOUND", message: "test not found" } };
  }
  if (
    test.status === "winner_a" ||
    test.status === "winner_b" ||
    test.status === "stopped" ||
    test.status === "inconclusive"
  ) {
    return {
      ok: false,
      error: { code: "ALREADY_ENDED", message: `test in status ${test.status}` },
    };
  }

  const { data: variants, error: vErr } = await supabase
    .from("opt_variants")
    .select(
      "id, client_id, landing_page_id, source_proposal_id, variant_label, brief_id, brief_run_id, page_version, change_set, generation_notes, status, generated_at, failed_reason, created_at, updated_at, created_by",
    )
    .in("id", [test.variant_a_id as string, test.variant_b_id as string]);
  if (vErr || !variants || variants.length !== 2) {
    return {
      ok: false,
      error: {
        code: "INTERNAL",
        message: `variants fetch failed: ${vErr?.message ?? "expected 2 rows"}`,
      },
    };
  }
  const variantA = variants.find((v) => v.id === test.variant_a_id) as VariantRow;
  const variantB = variants.find((v) => v.id === test.variant_b_id) as VariantRow;
  if (!variantA || !variantB) {
    return {
      ok: false,
      error: { code: "INTERNAL", message: "variant rows not aligned" },
    };
  }
  if (variantA.status !== "ready" || variantB.status !== "ready") {
    return {
      ok: false,
      error: {
        code: "VARIANTS_NOT_READY",
        message: `variants not yet ready (A=${variantA.status}, B=${variantB.status})`,
      },
    };
  }
  if (test.status === "running") {
    return { ok: true, test: test as TestRow, variant_a: variantA, variant_b: variantB };
  }

  const nowIso = new Date().toISOString();
  const updates = await Promise.all([
    supabase
      .from("opt_variants")
      .update({ status: "active", updated_at: nowIso })
      .in("id", [variantA.id, variantB.id]),
    supabase
      .from("opt_tests")
      .update({ status: "running", started_at: nowIso, updated_at: nowIso })
      .eq("id", testId),
  ]);
  for (const r of updates) {
    if (r.error) {
      logger.error("optimiser.activate_test.update_failed", {
        test_id: testId,
        error: r.error.message,
      });
      return {
        ok: false,
        error: { code: "INTERNAL", message: r.error.message },
      };
    }
  }
  // Refetch updated rows for the response payload.
  const { data: refreshedTest } = await supabase
    .from("opt_tests")
    .select(
      "id, client_id, landing_page_id, source_proposal_id, variant_a_id, variant_b_id, traffic_split_percent, status, min_sessions, min_conversions, winner_probability_a, winner_probability_b, last_metrics_snapshot, last_evaluated_at, started_at, ended_at, ended_reason, created_at, updated_at",
    )
    .eq("id", testId)
    .single();
  return {
    ok: true,
    test: (refreshedTest ?? { ...test, status: "running", started_at: nowIso }) as TestRow,
    variant_a: { ...variantA, status: "active" },
    variant_b: { ...variantB, status: "active" },
  };
}

/** Mark variants as 'ready'. Hooked from the brief-runner write
 * pipeline (or, for Slice 18 in isolation, from the activate route's
 * dry-run path). */
export async function markVariantReady(
  variantId: string,
  pageVersion: string | null,
): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from("opt_variants")
    .update({
      status: "ready",
      generated_at: new Date().toISOString(),
      page_version: pageVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("id", variantId);
  if (error) {
    throw new Error(`markVariantReady: ${error.message}`);
  }
}
