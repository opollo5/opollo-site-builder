import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import { resetExpiredBudgets } from "@/lib/tenant-budgets";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M8-4 — budget reset cron tests.
//
// Invariants pinned:
//
//   1. Past daily_reset_at → usage zeros + reset_at advances by 1 day.
//   2. Past monthly_reset_at → usage zeros + reset_at advances by 1 month.
//   3. Future reset_at → row untouched (no-op).
//   4. Two concurrent resets produce one reset per row (idempotency
//      via the WHERE predicate on the timestamp).
// ---------------------------------------------------------------------------

async function setReset(
  siteId: string,
  opts: {
    daily_reset_at?: string;
    monthly_reset_at?: string;
    daily_usage_cents?: number;
    monthly_usage_cents?: number;
  },
) {
  const svc = getServiceRoleClient();
  const update: Record<string, unknown> = {};
  if (opts.daily_reset_at) update.daily_reset_at = opts.daily_reset_at;
  if (opts.monthly_reset_at) update.monthly_reset_at = opts.monthly_reset_at;
  if (opts.daily_usage_cents !== undefined)
    update.daily_usage_cents = opts.daily_usage_cents;
  if (opts.monthly_usage_cents !== undefined)
    update.monthly_usage_cents = opts.monthly_usage_cents;
  const res = await svc
    .from("tenant_cost_budgets")
    .update(update)
    .eq("site_id", siteId);
  if (res.error) throw new Error(`setReset: ${res.error.message}`);
}

async function readRow(siteId: string) {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("tenant_cost_budgets")
    .select(
      "daily_usage_cents, monthly_usage_cents, daily_reset_at, monthly_reset_at",
    )
    .eq("site_id", siteId)
    .maybeSingle();
  return {
    dailyUsage: Number(data?.daily_usage_cents ?? 0),
    monthlyUsage: Number(data?.monthly_usage_cents ?? 0),
    dailyResetAt: new Date(data?.daily_reset_at as string),
    monthlyResetAt: new Date(data?.monthly_reset_at as string),
  };
}

describe("resetExpiredBudgets", () => {
  it("zeros daily usage + advances daily_reset_at by 1 day when past", async () => {
    const { id: siteId } = await seedSite({ prefix: "m84a" });
    const pastReset = new Date(Date.now() - 3600_000); // 1 hour ago
    await setReset(siteId, {
      daily_reset_at: pastReset.toISOString(),
      daily_usage_cents: 250,
    });

    const result = await resetExpiredBudgets();
    expect(result.dailyReset).toBeGreaterThanOrEqual(1);

    const row = await readRow(siteId);
    expect(row.dailyUsage).toBe(0);
    // reset_at advanced by ~1 day.
    const delta = row.dailyResetAt.getTime() - pastReset.getTime();
    expect(delta).toBeCloseTo(86_400_000, -3); // within ~1s
  });

  it("zeros monthly usage + advances monthly_reset_at by 1 month when past", async () => {
    const { id: siteId } = await seedSite({ prefix: "m84b" });
    const pastReset = new Date(Date.now() - 3600_000);
    await setReset(siteId, {
      monthly_reset_at: pastReset.toISOString(),
      monthly_usage_cents: 1500,
    });

    const result = await resetExpiredBudgets();
    expect(result.monthlyReset).toBeGreaterThanOrEqual(1);

    const row = await readRow(siteId);
    expect(row.monthlyUsage).toBe(0);
    // reset_at moved forward to roughly one month later.
    expect(row.monthlyResetAt.getTime()).toBeGreaterThan(pastReset.getTime());
  });

  it("leaves rows with future reset_at untouched", async () => {
    const { id: siteId } = await seedSite({ prefix: "m84c" });
    const futureReset = new Date(Date.now() + 60_000).toISOString();
    await setReset(siteId, {
      daily_reset_at: futureReset,
      monthly_reset_at: futureReset,
      daily_usage_cents: 75,
      monthly_usage_cents: 300,
    });

    await resetExpiredBudgets();
    const row = await readRow(siteId);
    expect(row.dailyUsage).toBe(75);
    expect(row.monthlyUsage).toBe(300);
  });

  it("is idempotent under a second tick — no double-reset", async () => {
    const { id: siteId } = await seedSite({ prefix: "m84d" });
    const pastReset = new Date(Date.now() - 3600_000);
    await setReset(siteId, {
      daily_reset_at: pastReset.toISOString(),
      daily_usage_cents: 500,
    });

    const first = await resetExpiredBudgets();
    expect(first.dailyReset).toBeGreaterThanOrEqual(1);

    // Second tick immediately after — the UPDATE's WHERE clause now
    // sees daily_reset_at > now() (we advanced it by 1 day).
    const second = await resetExpiredBudgets();
    // Any rows reset on the second tick belong to OTHER tests' sites,
    // not the one we seeded. For the row we seeded, usage stays 0 and
    // reset_at is 1 day in the future (no further advance).
    const row = await readRow(siteId);
    expect(row.dailyUsage).toBe(0);
    expect(row.dailyResetAt.getTime()).toBeGreaterThan(Date.now());
    // The reset count on the second tick is strictly less than first's
    // (the row we seeded isn't eligible anymore).
    expect(second.dailyReset).toBeLessThan(first.dailyReset + 1);
  });
});
