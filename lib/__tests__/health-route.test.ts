import { describe, expect, it } from "vitest";

import { GET as healthGET } from "@/app/api/health/route";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

type HealthBody = {
  status: string;
  checks: {
    supabase: string;
    supabase_latency_ms?: number;
    budget_reset_backlog: string;
    budget_reset_backlog_count: number;
    budget_reset_backlog_sample: string[];
    budget_reset_backlog_latency_ms?: number;
    budget_reset_backlog_error?: string;
  };
  build: { commit: string; env: string };
};

describe("GET /api/health", () => {
  it("returns 200 with status=ok when Supabase is reachable and no budget backlog", async () => {
    // Baseline: seedSite inserts a tenant_cost_budgets row via trigger
    // with daily/monthly reset_at pegged to today + 1 day / today + 1
    // month, so the backlog count should be zero.
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthBody;
    expect(body.status).toBe("ok");
    expect(body.checks.supabase).toBe("ok");
    expect(body.checks.budget_reset_backlog).toBe("ok");
    expect(body.checks.budget_reset_backlog_count).toBe(0);
    expect(body.checks.budget_reset_backlog_sample).toEqual([]);
    expect(typeof body.build.commit).toBe("string");
  });

  it("returns 503 degraded when a tenant_cost_budgets row's daily_reset_at is more than 25h in the past", async () => {
    const { id: siteId } = await seedSite({
      prefix: "m11c",
      name: "Budget backlog site",
    });

    // Simulate a stuck daily reset: the cron hasn't advanced this
    // row's daily_reset_at for more than the 25h threshold.
    const svc = getServiceRoleClient();
    const stuckAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    await svc
      .from("tenant_cost_budgets")
      .update({ daily_reset_at: stuckAt })
      .eq("site_id", siteId);

    const res = await healthGET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("ok");
    expect(body.checks.budget_reset_backlog).toBe("fail");
    expect(body.checks.budget_reset_backlog_count).toBeGreaterThanOrEqual(1);
    expect(body.checks.budget_reset_backlog_sample).toContain(siteId);
  });

  it("returns 503 degraded when monthly_reset_at is more than 25h in the past", async () => {
    const { id: siteId } = await seedSite({
      prefix: "m11d",
      name: "Monthly backlog site",
    });

    const svc = getServiceRoleClient();
    const stuckAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    await svc
      .from("tenant_cost_budgets")
      .update({ monthly_reset_at: stuckAt })
      .eq("site_id", siteId);

    const res = await healthGET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.checks.budget_reset_backlog).toBe("fail");
    expect(body.checks.budget_reset_backlog_sample).toContain(siteId);
  });

  it("caps the backlog sample at 5 site_ids", async () => {
    const svc = getServiceRoleClient();
    const stuckAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();

    const siteIds: string[] = [];
    for (let i = 0; i < 7; i++) {
      // sites.prefix caps at 4 chars (CHECK constraint), so keep the
      // test-generated prefix short.
      const { id } = await seedSite({
        prefix: `s${i}k`,
        name: `Stuck ${i}`,
      });
      siteIds.push(id);
    }
    await svc
      .from("tenant_cost_budgets")
      .update({ daily_reset_at: stuckAt })
      .in("site_id", siteIds);

    const res = await healthGET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthBody;
    expect(body.checks.budget_reset_backlog_count).toBeGreaterThanOrEqual(7);
    expect(body.checks.budget_reset_backlog_sample.length).toBeLessThanOrEqual(
      5,
    );
  });
});
