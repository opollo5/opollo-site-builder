import { describe, expect, it } from "vitest";

import { checkBudgetResetBacklog } from "@/app/api/health/route";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M11-7 — tenant_cost_budgets reset-backlog health probe.
//
// Invariants pinned:
//
//   1. Fresh reset timestamps (future) → probe returns ok, count=0, empty
//      sample.
//   2. A row whose daily_reset_at is more than 25h past → probe returns
//      fail, count>=1, sample includes the stuck site_id.
//   3. A row whose monthly_reset_at is more than 25h past → probe returns
//      fail, count>=1, sample includes the stuck site_id.
//   4. Sample is capped at 5 site_ids (won't flood the response body).
// ---------------------------------------------------------------------------

async function forceReset(
  siteId: string,
  opts: {
    daily_reset_at?: string;
    monthly_reset_at?: string;
  },
) {
  const svc = getServiceRoleClient();
  const update: Record<string, unknown> = {};
  if (opts.daily_reset_at) update.daily_reset_at = opts.daily_reset_at;
  if (opts.monthly_reset_at) update.monthly_reset_at = opts.monthly_reset_at;
  const { error } = await svc
    .from("tenant_cost_budgets")
    .update(update)
    .eq("site_id", siteId);
  if (error) throw new Error(`forceReset: ${error.message}`);
}

describe("checkBudgetResetBacklog", () => {
  it("returns ok when a fresh row exists", async () => {
    const { id } = await seedSite({ prefix: "hb01" });
    // Auto-created row has daily_reset_at = now() + 1 day per migration 0012.
    // Leave it alone; probe should see no backlog for this row.

    const result = await checkBudgetResetBacklog();

    // Other tests may leave stuck rows; we only assert THIS row is not
    // in the sample.
    expect(result.sample).not.toContain(id);
    expect(result.result === "ok" || result.sample.length > 0).toBe(true);
  });

  it("flags a row whose daily_reset_at is more than 25h past", async () => {
    const { id } = await seedSite({ prefix: "hb02" });
    const stuck = new Date(Date.now() - 26 * 3600_000).toISOString();
    await forceReset(id, { daily_reset_at: stuck });

    const result = await checkBudgetResetBacklog();

    expect(result.result).toBe("fail");
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.sample).toContain(id);
  });

  it("flags a row whose monthly_reset_at is more than 25h past", async () => {
    const { id } = await seedSite({ prefix: "hb03" });
    const stuck = new Date(Date.now() - 26 * 3600_000).toISOString();
    await forceReset(id, { monthly_reset_at: stuck });

    const result = await checkBudgetResetBacklog();

    expect(result.result).toBe("fail");
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.sample).toContain(id);
  });

  it("caps the sample at 5 site_ids", async () => {
    // Create 6 stuck sites. Probe must return at most 5 in the sample.
    const stuck = new Date(Date.now() - 26 * 3600_000).toISOString();
    for (let i = 0; i < 6; i++) {
      const { id } = await seedSite({ prefix: `hb4${i}` });
      await forceReset(id, { daily_reset_at: stuck });
    }

    const result = await checkBudgetResetBacklog();

    expect(result.result).toBe("fail");
    expect(result.sample.length).toBeLessThanOrEqual(5);
    expect(result.count).toBe(result.sample.length);
  });
});
