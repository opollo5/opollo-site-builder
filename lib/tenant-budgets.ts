import { Client } from "pg";

// ---------------------------------------------------------------------------
// M8-2 — Per-tenant cost budget enforcement.
//
// Two entry points:
//
//   reserveBudget(siteId, projectedCents, client)
//     Wraps a SELECT … FOR UPDATE on tenant_cost_budgets + an atomic
//     increment. If the projected cost would push either the daily or
//     monthly usage over its cap, returns
//     { ok: false, code: 'BUDGET_EXCEEDED', period, cap_cents,
//       usage_cents, projected_cents } and leaves usage untouched.
//     Otherwise increments and returns { ok: true }.
//
//     The FOR UPDATE holds a row lock for the duration of the caller's
//     transaction — two simultaneous reservations for the same tenant
//     serialise. No optimistic retry loops needed.
//
//   bumpTenantUsage(siteId, deltaCents, client)
//     Unconditional increment (no cap check). Called from the reset
//     cron (M8-4) for adjustments; external callers should prefer
//     reserveBudget. Exported so a future actual-vs-projected swap
//     has one place to hook in.
//
// Both helpers require a pg.Client inside an open transaction; the
// caller owns BEGIN/COMMIT. The rationale: reservations need to be
// rolled back if a downstream INSERT (job / slot) fails, so we can't
// auto-commit inside the helper.
//
// Defense-in-depth upsert: reserveBudget does an INSERT … ON CONFLICT
// DO NOTHING against tenant_cost_budgets before the SELECT, so a site
// whose budget row was deleted manually in SQL self-heals on the
// first reserveBudget call.
// ---------------------------------------------------------------------------

export type ReserveBudgetOk = { ok: true };
export type ReserveBudgetFail = {
  ok: false;
  code: "BUDGET_EXCEEDED" | "INTERNAL_ERROR";
  period?: "daily" | "monthly";
  cap_cents?: number;
  usage_cents?: number;
  projected_cents?: number;
  message: string;
};
export type ReserveBudgetResult = ReserveBudgetOk | ReserveBudgetFail;

/**
 * Reserve `projectedCents` of the site's budget. Caller owns the
 * transaction. Returns BUDGET_EXCEEDED if either daily or monthly cap
 * would be exceeded.
 */
export async function reserveBudget(
  client: Client,
  siteId: string,
  projectedCents: number,
): Promise<ReserveBudgetResult> {
  if (projectedCents < 0) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `reserveBudget called with negative projectedCents (${projectedCents}).`,
    };
  }

  // Self-heal if the budget row somehow got deleted. Trigger creates
  // it on site INSERT; this is belt-and-suspenders.
  await client.query(
    `
    INSERT INTO tenant_cost_budgets (site_id)
    VALUES ($1)
    ON CONFLICT (site_id) DO NOTHING
    `,
    [siteId],
  );

  const locked = await client.query<{
    daily_cap_cents: string;
    monthly_cap_cents: string;
    daily_usage_cents: string;
    monthly_usage_cents: string;
  }>(
    `
    SELECT daily_cap_cents, monthly_cap_cents,
           daily_usage_cents, monthly_usage_cents
      FROM tenant_cost_budgets
     WHERE site_id = $1
     FOR UPDATE
    `,
    [siteId],
  );
  const row = locked.rows[0];
  if (!row) {
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: `tenant_cost_budgets row missing for site ${siteId} after upsert.`,
    };
  }

  const dailyCap = Number(row.daily_cap_cents);
  const monthlyCap = Number(row.monthly_cap_cents);
  const dailyUsage = Number(row.daily_usage_cents);
  const monthlyUsage = Number(row.monthly_usage_cents);

  if (dailyUsage + projectedCents > dailyCap) {
    return {
      ok: false,
      code: "BUDGET_EXCEEDED",
      period: "daily",
      cap_cents: dailyCap,
      usage_cents: dailyUsage,
      projected_cents: projectedCents,
      message: `Daily budget of ${dailyCap} cents would be exceeded: ${dailyUsage} already used + ${projectedCents} projected.`,
    };
  }
  if (monthlyUsage + projectedCents > monthlyCap) {
    return {
      ok: false,
      code: "BUDGET_EXCEEDED",
      period: "monthly",
      cap_cents: monthlyCap,
      usage_cents: monthlyUsage,
      projected_cents: projectedCents,
      message: `Monthly budget of ${monthlyCap} cents would be exceeded: ${monthlyUsage} already used + ${projectedCents} projected.`,
    };
  }

  await client.query(
    `
    UPDATE tenant_cost_budgets
       SET daily_usage_cents = daily_usage_cents + $2,
           monthly_usage_cents = monthly_usage_cents + $2,
           updated_at = now()
     WHERE site_id = $1
    `,
    [siteId, projectedCents],
  );

  return { ok: true };
}

/**
 * Unconditional usage bump. Skips the cap check — used by reset /
 * reconciliation paths. Callers that are enqueueing billed work
 * should use reserveBudget instead.
 */
export async function bumpTenantUsage(
  client: Client,
  siteId: string,
  deltaCents: number,
): Promise<void> {
  await client.query(
    `
    INSERT INTO tenant_cost_budgets (site_id, daily_usage_cents, monthly_usage_cents)
    VALUES ($1, GREATEST(0, $2), GREATEST(0, $2))
    ON CONFLICT (site_id) DO UPDATE
      SET daily_usage_cents = GREATEST(0, tenant_cost_budgets.daily_usage_cents + $2),
          monthly_usage_cents = GREATEST(0, tenant_cost_budgets.monthly_usage_cents + $2),
          updated_at = now()
    `,
    [siteId, deltaCents],
  );
}

// ---------------------------------------------------------------------------
// Reset cron (M8-4)
// ---------------------------------------------------------------------------

export type BudgetResetResult = {
  dailyReset: number;
  monthlyReset: number;
};

function requireBudgetResetDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by resetExpiredBudgets for the cron UPDATEs.",
    );
  }
  return url;
}

/**
 * Zero daily/monthly usage for any row whose reset timestamp is past.
 * Advances the reset timestamp by one day / one month so the next
 * tick doesn't re-reset the same row.
 *
 * Two concurrent cron ticks hitting the same row serialise at the
 * row-lock layer — the second UPDATE sees no rows matching
 * `daily_reset_at < now()` because the first already advanced the
 * timestamp. No explicit advisory lock needed.
 *
 * Returns the count of rows reset in each period. Caller (cron
 * entrypoint) logs the result for observability.
 */
export async function resetExpiredBudgets(opts: {
  client?: Client | null;
} = {}): Promise<BudgetResetResult> {
  const run = async (c: Client): Promise<BudgetResetResult> => {
    const daily = await c.query(
      `
      UPDATE tenant_cost_budgets
         SET daily_usage_cents = 0,
             daily_reset_at = daily_reset_at + interval '1 day',
             updated_at = now()
       WHERE daily_reset_at < now()
      `,
    );
    const monthly = await c.query(
      `
      UPDATE tenant_cost_budgets
         SET monthly_usage_cents = 0,
             monthly_reset_at = monthly_reset_at + interval '1 month',
             updated_at = now()
       WHERE monthly_reset_at < now()
      `,
    );
    return {
      dailyReset: daily.rowCount ?? 0,
      monthlyReset: monthly.rowCount ?? 0,
    };
  };

  if (opts.client) return run(opts.client);
  const c = new Client({ connectionString: requireBudgetResetDbUrl() });
  await c.connect();
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}

// ---------------------------------------------------------------------------
// Projection helpers.
// ---------------------------------------------------------------------------

/**
 * Rough cost projection per batch slot. Opus 4.7 at ~8k tokens output
 * + ~40k input (cached system prompt + per-slot brief) lands at roughly
 * 30 cents per page. Conservative — actual costs tend to be lower with
 * the shared system-prompt cache amortising across the batch.
 *
 * Exported so M8-3 (iStock seed) can reuse the shared projection for
 * its own pre-flight budget check.
 */
export const PROJECTED_COST_PER_BATCH_SLOT_CENTS = 30;

/**
 * Rough cost projection per regen. Single-page regen is roughly the
 * same shape as one batch slot — same prompt, same token budget.
 */
export const PROJECTED_COST_PER_REGEN_CENTS = 30;
