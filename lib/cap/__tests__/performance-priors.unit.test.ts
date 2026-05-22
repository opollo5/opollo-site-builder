import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Supabase service-role mock
// ─────────────────────────────────────────────────────────────────────────────
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

import {
  fetchPerformancePriors,
  formatPerformancePriorsBlock,
  type PerformancePrior,
} from "@/lib/cap/performance-priors";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a mock analytics row */
function makeRow(
  id: string,
  engagementRate: number | null,
  impressions: number,
  content = `Post content for ${id}`,
) {
  return {
    bundle_post_id: id,
    engagement_rate: engagementRate,
    impressions,
    content,
  };
}

/** Wire mockFrom so profiles → analytics chain resolves correctly */
function setupMocks(analyticsRows: ReturnType<typeof makeRow>[]) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "platform_social_profiles") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ id: "profile-1" }],
            error: null,
          }),
        }),
      };
    }
    if (table === "social_post_analytics_snapshots") {
      const chain = {
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: analyticsRows, error: null }),
        select: vi.fn().mockReturnThis(),
      };
      return { select: vi.fn().mockReturnValue(chain) };
    }
    return {};
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// formatPerformancePriorsBlock (pure — no mocking needed)
// ─────────────────────────────────────────────────────────────────────────────

describe("formatPerformancePriorsBlock", () => {
  it("(a) renders all three posts with correct format", () => {
    const priors: PerformancePrior[] = [
      { engagementRate: 0.042, content: "First high-performing post" },
      { engagementRate: 0.031, content: "Second post in the list" },
      { engagementRate: 0.019, content: "Third post in the list" },
    ];
    const block = formatPerformancePriorsBlock(priors);
    expect(block).toContain("PERFORMANCE PRIORS");
    expect(block).toContain("1. [4.2%] — First high-performing post");
    expect(block).toContain("2. [3.1%] — Second post in the list");
    expect(block).toContain("3. [1.9%] — Third post in the list");
    expect(block).toContain("Do not copy them");
  });

  it("(b) renders a single post correctly", () => {
    const priors: PerformancePrior[] = [
      { engagementRate: 0.085, content: "Only qualifying post" },
    ];
    const block = formatPerformancePriorsBlock(priors);
    expect(block).toContain("1. [8.5%] — Only qualifying post");
    expect(block).not.toContain("2.");
  });

  it("(c) zero posts → returns empty string (block omitted entirely)", () => {
    expect(formatPerformancePriorsBlock([])).toBe("");
  });

  it("truncates content exceeding 400 chars and appends ellipsis", () => {
    const longText = "A".repeat(450);
    const priors: PerformancePrior[] = [{ engagementRate: 0.05, content: longText }];
    const block = formatPerformancePriorsBlock(priors);
    const line = block.split("\n").find((l) => l.startsWith("1."))!;
    expect(line).toContain("…");
    // content portion after "— " should be 400 chars + "…"
    const contentPart = line.split("— ")[1];
    expect(contentPart).toHaveLength(401); // 400 + "…"
  });

  it("collapses newlines in content to spaces", () => {
    const priors: PerformancePrior[] = [
      { engagementRate: 0.03, content: "Line one\nLine two\r\nLine three" },
    ];
    const block = formatPerformancePriorsBlock(priors);
    expect(block).toContain("Line one Line two Line three");
    // The post line itself must not contain embedded newlines
    const postLine = block.split("\n").find((l) => l.startsWith("1."))!;
    expect(postLine).not.toContain("\n");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchPerformancePriors (mocked Supabase)
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchPerformancePriors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: returns top 3 unique posts ordered by engagement_rate", async () => {
    setupMocks([
      makeRow("post-1", 0.08, 200),
      makeRow("post-2", 0.05, 150),
      makeRow("post-3", 0.03, 80),
    ]);

    const result = await fetchPerformancePriors("company-abc");
    expect(result).toHaveLength(3);
    expect(result[0].engagementRate).toBe(0.08);
    expect(result[1].engagementRate).toBe(0.05);
    expect(result[2].engagementRate).toBe(0.03);
    expect(result[0].content).toBe("Post content for post-1");
  });

  it("deduplicates rows with the same bundle_post_id, keeping the highest-rate occurrence", async () => {
    setupMocks([
      makeRow("post-A", 0.09, 300),
      makeRow("post-A", 0.07, 250), // duplicate — same post, older snapshot
      makeRow("post-B", 0.04, 100),
      makeRow("post-C", 0.02, 60),
    ]);

    const result = await fetchPerformancePriors("company-abc");
    expect(result).toHaveLength(3);
    // post-A appears once at 0.09 (first / highest)
    expect(result.filter((p) => p.engagementRate === 0.09)).toHaveLength(1);
  });

  it("(d) filters out rows with null engagement_rate", async () => {
    setupMocks([
      makeRow("post-null", null, 200),  // null rate — should be excluded
      makeRow("post-good", 0.05, 100),
    ]);

    const result = await fetchPerformancePriors("company-abc");
    expect(result).toHaveLength(1);
    expect(result[0].engagementRate).toBe(0.05);
  });

  it("(e) filters out rows with impressions < 50", async () => {
    setupMocks([
      makeRow("post-low", 0.99, 10),   // very high rate but low impressions — noise
      makeRow("post-ok", 0.04, 50),
    ]);

    const result = await fetchPerformancePriors("company-abc");
    expect(result).toHaveLength(1);
    expect(result[0].engagementRate).toBe(0.04);
  });

  it("returns [] when no qualifying posts exist", async () => {
    setupMocks([]);
    const result = await fetchPerformancePriors("company-new");
    expect(result).toEqual([]);
  });

  it("returns [] when company has no social profiles", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "platform_social_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {};
    });

    const result = await fetchPerformancePriors("company-no-profiles");
    expect(result).toEqual([]);
  });

  it("returns [] on profiles query error (soft degradation)", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "platform_social_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "DB connection error" },
            }),
          }),
        };
      }
      return {};
    });

    const result = await fetchPerformancePriors("company-abc");
    expect(result).toEqual([]);
  });

  it("returns [] on analytics query error (soft degradation)", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "platform_social_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ id: "profile-1" }],
              error: null,
            }),
          }),
        };
      }
      if (table === "social_post_analytics_snapshots") {
        const chain = {
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: null, error: { message: "timeout" } }),
          select: vi.fn().mockReturnThis(),
        };
        return { select: vi.fn().mockReturnValue(chain) };
      }
      return {};
    });

    const result = await fetchPerformancePriors("company-abc");
    expect(result).toEqual([]);
  });

  it("filters out rows with null content", async () => {
    setupMocks([
      { bundle_post_id: "post-no-content", engagement_rate: 0.1, impressions: 200, content: null as unknown as string },
      makeRow("post-with-content", 0.05, 100),
    ]);

    const result = await fetchPerformancePriors("company-abc");
    expect(result).toHaveLength(1);
    expect(result[0].engagementRate).toBe(0.05);
  });
});
