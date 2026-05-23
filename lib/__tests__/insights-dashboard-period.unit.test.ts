import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ getServiceRoleClient: vi.fn() }));

afterEach(() => vi.resetModules());

// ---------------------------------------------------------------------------
// Smart supabase mock: .gte("snapshot_date", cutoff) actually filters rows
// so that different period params produce different postCount values.
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown>;

function makeSmartSvc(tableData: Record<string, MockRow[]>) {
  return {
    from: (table: string) => {
      let snapshotDateGte: string | null = null;
      const rows: MockRow[] = tableData[table] ?? [];

      function filtered(): MockRow[] {
        if (!snapshotDateGte) return rows;
        return rows.filter(
          (r) =>
            typeof r.snapshot_date === "string" &&
            (r.snapshot_date as string) >= snapshotDateGte!,
        );
      }

      const chain: Record<string, unknown> = {
        select: vi.fn(() => chain),
        in: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        order: vi.fn(() => chain),
        neq: vi.fn(() => chain),
        contains: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        gt: vi.fn(() => chain),
        gte: vi.fn((col: string, val: string) => {
          if (col === "snapshot_date") snapshotDateGte = val;
          return chain;
        }),
        limit: vi.fn(() => Promise.resolve({ data: filtered(), error: null })),
        then: (
          onFulfilled: (v: { data: MockRow[]; error: null }) => unknown,
          onRejected?: (e: unknown) => unknown,
        ) =>
          Promise.resolve({ data: filtered(), error: null }).then(
            onFulfilled,
            onRejected,
          ),
      };

      return chain;
    },
  };
}

function daysAgoDate(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function makeSnapshot(daysAgo: number, bundlePostId: string): MockRow {
  return {
    id: bundlePostId,
    bundle_post_id: bundlePostId,
    profile_id: "profile-1",
    platform: "linkedin_company",
    posted_at: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    content: "test post",
    impressions: 100,
    likes: 5,
    comments: 2,
    shares: 1,
    engagement_rate: 0.05,
    snapshot_date: daysAgoDate(daysAgo),
  };
}

// 2 unique posts within 7d, 4 within 30d, 6 within 90d
const PERIOD_SNAPSHOTS: MockRow[] = [
  makeSnapshot(2, "bp-1"),
  makeSnapshot(5, "bp-2"),
  makeSnapshot(10, "bp-3"),
  makeSnapshot(20, "bp-4"),
  makeSnapshot(50, "bp-5"),
  makeSnapshot(80, "bp-6"),
];

const PROFILE_ROW: MockRow = { id: "profile-1" };

describe("getInsightsDashboardData — period filtering", () => {
  async function runWithPeriod(period: "7d" | "30d" | "90d") {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSmartSvc({
        platform_social_profiles: [PROFILE_ROW],
        social_post_analytics_snapshots: PERIOD_SNAPSHOTS,
        ins_post_features: [],
        social_connections: [],
        social_post_master: [],
        ins_ingest_log: [],
      }) as never,
    );
    const { getInsightsDashboardData } = await import("@/lib/insights/dashboard");
    return getInsightsDashboardData("company-1", period);
  }

  it("7d returns 2 posts (only snapshots within 7 days)", async () => {
    const result = await runWithPeriod("7d");
    expect(result.postCount).toBe(2);
    expect(result.period).toBe("7d");
  });

  it("30d returns 4 posts (snapshots within 30 days)", async () => {
    vi.resetModules();
    const result = await runWithPeriod("30d");
    expect(result.postCount).toBe(4);
    expect(result.period).toBe("30d");
  });

  it("90d returns 6 posts (all snapshots within 90 days)", async () => {
    vi.resetModules();
    const result = await runWithPeriod("90d");
    expect(result.postCount).toBe(6);
    expect(result.period).toBe("90d");
  });

  it("7d postCount is less than 30d postCount", async () => {
    vi.resetModules();
    const r7 = await runWithPeriod("7d");
    vi.resetModules();
    const r30 = await runWithPeriod("30d");
    expect(r7.postCount).toBeLessThan(r30.postCount);
  });

  it("30d postCount is less than 90d postCount", async () => {
    vi.resetModules();
    const r30 = await runWithPeriod("30d");
    vi.resetModules();
    const r90 = await runWithPeriod("90d");
    expect(r30.postCount).toBeLessThan(r90.postCount);
  });

  it("defaults to 30d when period omitted", async () => {
    vi.resetModules();
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSmartSvc({
        platform_social_profiles: [PROFILE_ROW],
        social_post_analytics_snapshots: PERIOD_SNAPSHOTS,
        ins_post_features: [],
        social_connections: [],
        social_post_master: [],
        ins_ingest_log: [],
      }) as never,
    );
    const { getInsightsDashboardData } = await import("@/lib/insights/dashboard");
    const result = await getInsightsDashboardData("company-1");
    expect(result.period).toBe("30d");
    expect(result.postCount).toBe(4);
  });

  it("returns empty dashboard with correct period when no profiles", async () => {
    vi.resetModules();
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSmartSvc({
        platform_social_profiles: [],
        social_post_analytics_snapshots: PERIOD_SNAPSHOTS,
        ins_post_features: [],
        social_connections: [],
        social_post_master: [],
        ins_ingest_log: [],
      }) as never,
    );
    const { getInsightsDashboardData } = await import("@/lib/insights/dashboard");
    const result = await getInsightsDashboardData("company-1", "7d");
    expect(result.postCount).toBe(0);
    expect(result.period).toBe("7d");
  });
});
