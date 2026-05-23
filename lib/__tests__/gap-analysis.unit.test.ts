import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.resetModules();
});

const COMPANY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeSvc(opts: {
  consent: boolean;
  hasAccounts: boolean;
  yourFeatures: unknown[];
  competitorPosts: unknown[];
}) {
  return {
    from: (table: string) => {
      if (table === "ins_consent") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { competitor_tracking_consent: opts.consent },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "ins_competitor_accounts") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                limit: () =>
                  Promise.resolve({
                    data: opts.hasAccounts ? [{ id: "acc-1" }] : [],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "ins_post_features") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  gte: () =>
                    Promise.resolve({ data: opts.yourFeatures, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "ins_competitor_posts") {
        return {
          select: () => ({
            contains: () => ({
              gte: () =>
                Promise.resolve({ data: opts.competitorPosts, error: null }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    },
  };
}

describe("computeGapAnalysis", () => {
  it("returns null when consent is OFF", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () =>
        makeSvc({ consent: false, hasAccounts: true, yourFeatures: [], competitorPosts: [] }),
    }));
    const { computeGapAnalysis } = await import("@/lib/insights/gap-analysis");
    const result = await computeGapAnalysis(COMPANY_ID);
    expect(result).toBeNull();
  });

  it("returns null when no competitor accounts", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () =>
        makeSvc({ consent: true, hasAccounts: false, yourFeatures: [], competitorPosts: [] }),
    }));
    const { computeGapAnalysis } = await import("@/lib/insights/gap-analysis");
    const result = await computeGapAnalysis(COMPANY_ID);
    expect(result).toBeNull();
  });

  it("returns null when both data sets are empty", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () =>
        makeSvc({ consent: true, hasAccounts: true, yourFeatures: [], competitorPosts: [] }),
    }));
    const { computeGapAnalysis } = await import("@/lib/insights/gap-analysis");
    const result = await computeGapAnalysis(COMPANY_ID);
    expect(result).toBeNull();
  });

  it("computes cadence gap correctly", async () => {
    const now = new Date().toISOString();
    const yourPosts = Array.from({ length: 8 }, (_, i) => ({
      topic_tags: ["security"],
      media_type: "text",
      engagement_rate: 0.03,
      posted_at: now,
    }));
    const compPosts = Array.from({ length: 15 }, () => ({
      engagement_rate: 0.05,
      posted_at: now,
      scraped_at: now,
      likes: 10,
      comments: 2,
      impressions: 500,
    }));

    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () =>
        makeSvc({ consent: true, hasAccounts: true, yourFeatures: yourPosts, competitorPosts: compPosts }),
    }));
    const { computeGapAnalysis } = await import("@/lib/insights/gap-analysis");
    const result = await computeGapAnalysis(COMPANY_ID);
    expect(result).not.toBeNull();
    expect(result!.cadenceGap.yourPostsPerMonth).toBeGreaterThan(0);
    expect(result!.cadenceGap.competitorAvgPostsPerMonth).toBeGreaterThan(0);
  });

  it("computes engagement benchmark with your rate vs competitor median", async () => {
    const now = new Date().toISOString();
    const yourPosts = Array.from({ length: 10 }, (_, i) => ({
      topic_tags: null,
      media_type: "text",
      engagement_rate: 0.04 + i * 0.001,
      posted_at: now,
    }));
    const compPosts = Array.from({ length: 10 }, (_, i) => ({
      engagement_rate: 0.06 + i * 0.001,
      posted_at: now,
      scraped_at: now,
    }));

    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () =>
        makeSvc({ consent: true, hasAccounts: true, yourFeatures: yourPosts, competitorPosts: compPosts }),
    }));
    const { computeGapAnalysis } = await import("@/lib/insights/gap-analysis");
    const result = await computeGapAnalysis(COMPANY_ID);
    expect(result).not.toBeNull();
    expect(result!.engagementBenchmark.yourRate).toBeGreaterThan(0);
    expect(result!.engagementBenchmark.competitorMedian).toBeGreaterThan(0);
    // Competitor should be higher in this fixture
    expect(result!.engagementBenchmark.deltaPercent).toBeLessThan(0);
  });

  it("videoMultiplier is > 1 when video posts outperform non-video", async () => {
    const now = new Date().toISOString();
    const yourPosts = [
      { topic_tags: null, media_type: "video", engagement_rate: 0.10, posted_at: now },
      { topic_tags: null, media_type: "video", engagement_rate: 0.12, posted_at: now },
      { topic_tags: null, media_type: "text", engagement_rate: 0.03, posted_at: now },
      { topic_tags: null, media_type: "text", engagement_rate: 0.04, posted_at: now },
    ];

    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () =>
        makeSvc({ consent: true, hasAccounts: true, yourFeatures: yourPosts, competitorPosts: [] }),
    }));
    const { computeGapAnalysis } = await import("@/lib/insights/gap-analysis");
    const result = await computeGapAnalysis(COMPANY_ID);
    expect(result).not.toBeNull();
    expect(result!.formatGap.videoMultiplier).toBeGreaterThan(1);
  });

  it("topic gap contains your topics correctly", async () => {
    const now = new Date().toISOString();
    const yourPosts = [
      { topic_tags: ["ransomware", "msp"], media_type: "text", engagement_rate: 0.03, posted_at: now },
      { topic_tags: ["ransomware"], media_type: "text", engagement_rate: 0.04, posted_at: now },
      { topic_tags: ["msp"], media_type: "text", engagement_rate: 0.02, posted_at: now },
    ];

    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () =>
        makeSvc({ consent: true, hasAccounts: true, yourFeatures: yourPosts, competitorPosts: [] }),
    }));
    const { computeGapAnalysis } = await import("@/lib/insights/gap-analysis");
    const result = await computeGapAnalysis(COMPANY_ID);
    expect(result).not.toBeNull();
    const topicNames = result!.topicGap.yourTopics.map((t) => t.topic);
    expect(topicNames).toContain("ransomware");
    expect(topicNames).toContain("msp");
    // ransomware appears twice, msp appears twice — should be equal or ranked
    const ransomware = result!.topicGap.yourTopics.find((t) => t.topic === "ransomware");
    expect(ransomware?.count).toBe(2);
  });
});
