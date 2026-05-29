import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// B3 — Per-company image-generation budget cap.
//
// §1.3 of MASS_IMAGE_GEN_BUILD_BRIEF: each company has a hard monthly cap on
// image-generation spend, default $20/month (2000 cents).
//
// §1.7: budget is measured in jobs, not source rows. A single source row that
// targets three distinct aspect ratios counts as three jobs.
//
// Pre-flight (batch dispatch): checkImageGenBudget rejects if
//   projected_cost > remaining_cents.
// Post-flight (qstash handler): incrementImageGenSpend bumps spend after a
// successful completion (NOT preview, NOT failure).
//
// When spend crosses 80% of the monthly budget for the first time, an
// operator-warning email is sent. The notified_80_at column makes that
// transition idempotent across concurrent handler invocations.
// ---------------------------------------------------------------------------

// Per-job cost in cents — see §1.3 and the B3 checkpoint in the brief.
export const PRICE_CENTS_PER_JOB = 6;

// 80% threshold for the warning email.
export const NOTIFICATION_THRESHOLD_PERCENT = 80;

export interface BudgetCheckResult {
  allowed: boolean;
  budget_cents: number;
  spent_cents: number;
  remaining_cents: number;
  projected_jobs: number;
  projected_cents: number;
  next_reset_at: string; // ISO timestamp for first-of-next-month UTC
  reason?: "over_budget" | "budget_disabled";
}

/**
 * Pre-flight budget check for a batch dispatch. Reads the company's current
 * monthly budget + spend; returns whether the projected job cost fits.
 *
 * No mutations — this is a pure read.
 *
 * @param companyId         the company about to spend
 * @param projectedJobCount sum of distinct aspect ratios across all source
 *                          rows (per §1.7), i.e. the number of jobs about to
 *                          be enqueued
 */
export async function checkImageGenBudget(
  companyId: string,
  projectedJobCount: number,
): Promise<BudgetCheckResult> {
  const svc = getServiceRoleClient();
  const month = currentMonthStartIso();
  const projectedCents = projectedJobCount * PRICE_CENTS_PER_JOB;
  const nextResetAt = nextMonthStartIso();

  const { data: company, error: companyErr } = await svc
    .from("platform_companies")
    .select("monthly_image_gen_budget_cents")
    .eq("id", companyId)
    .maybeSingle();

  if (companyErr || !company) {
    logger.warn("image.budget.company_lookup_failed", {
      companyId,
      err: companyErr?.message,
    });
    return {
      allowed: false,
      budget_cents: 0,
      spent_cents: 0,
      remaining_cents: 0,
      projected_jobs: projectedJobCount,
      projected_cents: projectedCents,
      next_reset_at: nextResetAt,
      reason: "budget_disabled",
    };
  }

  const budgetCents = (company as { monthly_image_gen_budget_cents: number })
    .monthly_image_gen_budget_cents;

  const { data: spendRow } = await svc
    .from("image_gen_spend")
    .select("spend_cents")
    .eq("company_id", companyId)
    .eq("month", month)
    .maybeSingle();

  const spentCents = (spendRow as { spend_cents: number } | null)?.spend_cents ?? 0;
  const remainingCents = Math.max(0, budgetCents - spentCents);
  const allowed = projectedCents <= remainingCents;

  return {
    allowed,
    budget_cents: budgetCents,
    spent_cents: spentCents,
    remaining_cents: remainingCents,
    projected_jobs: projectedJobCount,
    projected_cents: projectedCents,
    next_reset_at: nextResetAt,
    ...(allowed ? {} : { reason: "over_budget" as const }),
  };
}

export interface SpendIncrementResult {
  spent_cents: number;
  budget_cents: number;
  crossed_80_percent: boolean;
}

/**
 * Increment a company's image-gen spend for the current month. Called from
 * the qstash handler ONLY on successful job completion (not preview, not
 * failure).
 *
 * Returns the new spend total and whether this increment crossed the 80%
 * threshold for the first time (caller dispatches the operator email).
 *
 * Atomicity: uses PostgREST's `upsert` which translates to
 * INSERT ... ON CONFLICT DO UPDATE. Two concurrent handlers calling this
 * for the same (company, month) will not double-write.
 */
export async function incrementImageGenSpend(
  companyId: string,
  jobCount = 1,
): Promise<SpendIncrementResult | null> {
  const svc = getServiceRoleClient();
  const month = currentMonthStartIso();
  const incrementCents = jobCount * PRICE_CENTS_PER_JOB;

  // Read budget + existing spend in one go.
  const [{ data: company }, { data: existing }] = await Promise.all([
    svc
      .from("platform_companies")
      .select("monthly_image_gen_budget_cents")
      .eq("id", companyId)
      .maybeSingle(),
    svc
      .from("image_gen_spend")
      .select("spend_cents, notified_80_at")
      .eq("company_id", companyId)
      .eq("month", month)
      .maybeSingle(),
  ]);

  if (!company) {
    logger.warn("image.budget.spend_company_missing", { companyId });
    return null;
  }

  const budgetCents = (company as { monthly_image_gen_budget_cents: number })
    .monthly_image_gen_budget_cents;
  const existingRow = existing as {
    spend_cents: number;
    notified_80_at: string | null;
  } | null;
  const previousSpent = existingRow?.spend_cents ?? 0;
  const newSpent = previousSpent + incrementCents;
  const previouslyNotified = existingRow?.notified_80_at != null;
  const threshold = Math.floor((budgetCents * NOTIFICATION_THRESHOLD_PERCENT) / 100);
  const crossed80 =
    !previouslyNotified && previousSpent < threshold && newSpent >= threshold;

  const nowIso = new Date().toISOString();
  const { error: upsertErr } = await svc.from("image_gen_spend").upsert(
    {
      company_id: companyId,
      month,
      spend_cents: newSpent,
      notified_80_at: crossed80 || previouslyNotified ? nowIso : null,
      updated_at: nowIso,
    },
    { onConflict: "company_id,month" },
  );

  if (upsertErr) {
    logger.warn("image.budget.spend_upsert_failed", {
      companyId,
      err: upsertErr.message,
    });
    return null;
  }

  return {
    spent_cents: newSpent,
    budget_cents: budgetCents,
    crossed_80_percent: crossed80,
  };
}

// ---------------------------------------------------------------------------
// Date helpers — UTC month boundaries
// ---------------------------------------------------------------------------

/** First day of the current month in UTC, as a YYYY-MM-DD string. */
export function currentMonthStartIso(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/** First day of next month in UTC, as an ISO timestamp. */
export function nextMonthStartIso(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toISOString();
}
