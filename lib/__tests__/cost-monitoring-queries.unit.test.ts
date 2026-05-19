import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

import { capCostSummary, tenantBudgetSummary, buildCostReport } from "@/lib/platform/cost-monitoring/queries";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    ...overrides,
  };
  return chain;
}

// ---------------------------------------------------------------------------
// capCostSummary
// ---------------------------------------------------------------------------

describe("capCostSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when subscriptions query fails", async () => {
    mockFrom.mockReturnValue(makeChain({ select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }) }));
    // subscriptions query is: from("cap_subscriptions").select(...).in(...)
    // We need to handle that the first call to from returns an erroring chain
    const subsChain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
    };
    mockFrom.mockReturnValue(subsChain);

    const result = await capCostSummary(24);
    expect(result).toEqual([]);
  });

  it("returns rows with zero cost when no campaigns exist", async () => {
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      callCount++;
      if (table === "cap_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              {
                id: "sub-1",
                company_id: "co-1",
                tier: "starter",
                monthly_cost_cap_usd: "200.00",
                platform_companies: { name: "Acme Ltd" },
              },
            ],
            error: null,
          }),
        };
      }
      if (table === "cap_campaigns") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return makeChain();
    });

    const result = await capCostSummary(24);
    expect(result).toHaveLength(1);
    expect(result[0].company_name).toBe("Acme Ltd");
    expect(result[0].period_cost_usd).toBe(0);
    expect(result[0].run_count).toBe(0);
    expect(result[0].monthly_cap_usd).toBe(200);
  });

  it("aggregates generation run costs correctly", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              {
                id: "sub-1",
                company_id: "co-1",
                tier: "growth",
                monthly_cost_cap_usd: "200.00",
                platform_companies: { name: "Beta Co" },
              },
            ],
            error: null,
          }),
        };
      }
      if (table === "cap_campaigns") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ id: "camp-1" }, { id: "camp-2" }], error: null }),
        };
      }
      if (table === "cap_generation_runs") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [
              { estimated_cost_usd: "0.1200" },
              { estimated_cost_usd: "0.0800" },
              { estimated_cost_usd: "0.0500" },
            ],
            error: null,
          }),
        };
      }
      return makeChain();
    });

    const result = await capCostSummary(24);
    expect(result).toHaveLength(1);
    expect(result[0].run_count).toBe(3);
    expect(result[0].period_cost_usd).toBeCloseTo(0.25, 4);
    expect(result[0].cap_utilisation_pct).toBeCloseTo(0.13, 2);
  });

  it("sorts by period_cost_usd descending", async () => {
    let runCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              { id: "sub-1", company_id: "co-1", tier: "starter", monthly_cost_cap_usd: "200.00", platform_companies: { name: "Low Spend" } },
              { id: "sub-2", company_id: "co-2", tier: "growth", monthly_cost_cap_usd: "200.00", platform_companies: { name: "High Spend" } },
            ],
            error: null,
          }),
        };
      }
      if (table === "cap_campaigns") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ id: "camp-x" }], error: null }),
        };
      }
      if (table === "cap_generation_runs") {
        const chain = {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          eq: vi.fn(),
        };
        chain.eq.mockImplementation(() => {
          runCall++;
          return Promise.resolve({
            data: runCall === 1
              ? [{ estimated_cost_usd: "0.01" }]
              : [{ estimated_cost_usd: "0.50" }, { estimated_cost_usd: "0.30" }],
            error: null,
          });
        });
        return chain;
      }
      return makeChain();
    });

    const result = await capCostSummary(24);
    expect(result[0].company_name).toBe("High Spend");
    expect(result[1].company_name).toBe("Low Spend");
  });
});

// ---------------------------------------------------------------------------
// tenantBudgetSummary
// ---------------------------------------------------------------------------

describe("tenantBudgetSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array when budgets query fails", async () => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
    });

    const result = await tenantBudgetSummary();
    expect(result).toEqual([]);
  });

  it("calculates utilisation percentages correctly", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "tenant_cost_budgets") {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                site_id: "site-1",
                daily_usage_cents: 250,
                daily_cap_cents: 500,
                monthly_usage_cents: 5000,
                monthly_cap_cents: 10000,
              },
            ],
            error: null,
          }),
        };
      }
      if (table === "sites") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [{ id: "site-1", name: "Test Site" }], error: null }),
        };
      }
      return makeChain();
    });

    const result = await tenantBudgetSummary();
    expect(result).toHaveLength(1);
    expect(result[0].site_name).toBe("Test Site");
    expect(result[0].daily_utilisation_pct).toBe(50);
    expect(result[0].monthly_utilisation_pct).toBe(50);
  });

  it("handles zero caps without division by zero", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "tenant_cost_budgets") {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                site_id: "site-2",
                daily_usage_cents: 0,
                daily_cap_cents: 0,
                monthly_usage_cents: 0,
                monthly_cap_cents: 0,
              },
            ],
            error: null,
          }),
        };
      }
      if (table === "sites") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return makeChain();
    });

    const result = await tenantBudgetSummary();
    expect(result[0].daily_utilisation_pct).toBe(0);
    expect(result[0].monthly_utilisation_pct).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildCostReport
// ---------------------------------------------------------------------------

describe("buildCostReport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates cap and tenant data into report shape", async () => {
    // Cap: no subscriptions
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === "tenant_cost_budgets") {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return makeChain();
    });

    const report = await buildCostReport(24);

    expect(report.periodHours).toBe(24);
    expect(report.cap.subscriptionCount).toBe(0);
    expect(report.cap.totalPeriodCostUsd).toBe(0);
    expect(report.tenant.siteCount).toBe(0);
    expect(report.generatedAt).toBeTruthy();
  });

  it("counts high-utilisation subscriptions above 80% threshold", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [
              { id: "sub-1", company_id: "co-1", tier: "agency", monthly_cost_cap_usd: "100.00", platform_companies: { name: "Big Co" } },
            ],
            error: null,
          }),
        };
      }
      if (table === "cap_campaigns") {
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [{ id: "camp-1" }], error: null }) };
      }
      if (table === "cap_generation_runs") {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [{ estimated_cost_usd: "85.00" }], error: null }),
        };
      }
      if (table === "tenant_cost_budgets") {
        return { select: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: [], error: null }) };
      }
      return makeChain();
    });

    const report = await buildCostReport(24);
    expect(report.cap.highUtilisationCount).toBe(1);
    expect(report.cap.totalPeriodCostUsd).toBeCloseTo(85, 2);
  });
});
