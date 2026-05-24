import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.resetModules();
});

const COMPANY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PLATFORM = "LINKEDIN";

const SAMPLE_PATTERN = {
  id: "p1",
  pattern_type: "cross_segment_format_pattern",
  applies_to_platforms: ["LINKEDIN", "FACEBOOK"],
  pattern_data: { word_count_band: "short", mean_engagement: 0.065 },
  sample_size_n_companies: 8,
  sample_size_n_posts: 250,
  confidence_score: 0.72,
  mined_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
};

describe("pattern-application: findApplicablePatterns", () => {
  it("returns empty array when company has not consented", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { cross_client_learning_consent: false }, error: null }),
            }),
          }),
        }),
      }),
    }));

    const { findApplicablePatterns } = await import("@/lib/insights/pattern-application");
    const result = await findApplicablePatterns(COMPANY_ID, PLATFORM, "BEST_LENGTH_BAND");
    expect(result).toEqual([]);
  });

  it("returns empty array when company has no consent row", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    }));

    const { findApplicablePatterns } = await import("@/lib/insights/pattern-application");
    const result = await findApplicablePatterns(COMPANY_ID, PLATFORM, "BEST_LENGTH_BAND");
    expect(result).toEqual([]);
  });

  it("returns patterns when company has consented", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => ({
        from: (table: string) => {
          if (table === "ins_consent") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { cross_client_learning_consent: true },
                      error: null,
                    }),
                }),
              }),
            };
          }
          // ins_pattern_library
          return {
            select: () => ({
              eq: () => ({
                contains: () => ({
                  gt: () => ({
                    order: () => ({
                      limit: () => Promise.resolve({ data: [SAMPLE_PATTERN], error: null }),
                    }),
                  }),
                }),
              }),
            }),
          };
        },
      }),
    }));

    const { findApplicablePatterns } = await import("@/lib/insights/pattern-application");
    const result = await findApplicablePatterns(COMPANY_ID, PLATFORM, "BEST_LENGTH_BAND");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pattern_type: "cross_segment_format_pattern" });
  });

  it("maps TOPIC_PERFORMANCE to cross_segment_topic_lift pattern type", async () => {
    const patternQueryCalls: string[] = [];
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => ({
        from: (table: string) => {
          if (table === "ins_consent") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: { cross_client_learning_consent: true }, error: null }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: (_col: string, val: string) => {
                patternQueryCalls.push(val);
                return {
                  contains: () => ({
                    gt: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                      }),
                    }),
                  }),
                };
              },
            }),
          };
        },
      }),
    }));

    const { findApplicablePatterns } = await import("@/lib/insights/pattern-application");
    await findApplicablePatterns(COMPANY_ID, PLATFORM, "TOPIC_PERFORMANCE");
    expect(patternQueryCalls).toContain("cross_segment_topic_lift");
  });
});

describe("pattern-application: buildIndustrySignalSummary", () => {
  it("returns empty string for empty patterns array", async () => {
    const { buildIndustrySignalSummary } = await import("@/lib/insights/pattern-application");
    expect(buildIndustrySignalSummary([])).toBe("");
  });

  it("builds a format pattern summary", async () => {
    const { buildIndustrySignalSummary } = await import("@/lib/insights/pattern-application");
    const summary = buildIndustrySignalSummary([
      {
        ...SAMPLE_PATTERN,
        pattern_type: "cross_segment_format_pattern",
        pattern_data: { word_count_band: "short", mean_engagement: 0.065 },
      },
    ]);
    expect(summary).toContain("short");
    expect(summary).toContain("6.5%");
  });

  it("builds a topic lift summary", async () => {
    const { buildIndustrySignalSummary } = await import("@/lib/insights/pattern-application");
    const summary = buildIndustrySignalSummary([
      {
        ...SAMPLE_PATTERN,
        pattern_type: "cross_segment_topic_lift",
        pattern_data: { topic: "ransomware", mean_engagement: 0.08, lift: 1.6 },
      },
    ]);
    expect(summary).toContain("ransomware");
    expect(summary).toContain("1.6");
  });
});
