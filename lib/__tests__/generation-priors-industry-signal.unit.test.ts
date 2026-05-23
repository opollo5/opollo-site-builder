/**
 * L1/L6 — generation-priors API: industry_signal field behaviour
 *
 * Tests:
 * - include_industry_signal not set → industry_signal is null
 * - include_industry_signal=true + consent OFF → null (graceful degradation, NOT 400)
 * - include_industry_signal=true + consent ON → populated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/platform/cron/cron-shared", () => ({
  authorisedCronRequest: vi.fn().mockReturnValue(true),
  unauthorisedResponse: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/cap/performance-priors", () => ({
  fetchPerformancePriors: vi.fn().mockResolvedValue([]),
  formatPerformancePriorsBlock: vi.fn().mockReturnValue(""),
}));

import { getServiceRoleClient } from "@/lib/supabase";

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

function makeSvc(opts: { consent: boolean; hasPatterns: boolean }) {
  return {
    from: (table: string) => {
      if (table === "ins_recommendations") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    in: vi.fn().mockReturnValue({
                      order: vi.fn().mockReturnValue({
                        data: [
                          {
                            id: "r1",
                            recommendation_type: "BEST_LENGTH_BAND",
                            confidence_score: 0.75,
                            confidence_band: "strong",
                            suppressed: false,
                            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                          },
                        ],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "ins_client_memory") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        };
      }
      if (table === "ins_post_features") {
        const row = {
          posted_at: new Date().toISOString(),
          media_type: null,
          has_question: true,
          day_of_week: 2,
          hour_of_day_client_tz: 9,
          topic_tags: null,
        };
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    data: [row],
                    error: null,
                    limit: vi.fn().mockResolvedValue({ data: [row], error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "ins_consent") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({
                  data: { cross_client_learning_consent: opts.consent },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "ins_pattern_library") {
        return {
          select: vi.fn().mockReturnValue({
            gt: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: opts.hasPatterns ? [SAMPLE_PATTERN] : [],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      // suppressed recs
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    },
  };
}

function makeRequest(params: Record<string, string>): NextRequest {
  const url = `http://localhost/api/insights/generation-priors?${new URLSearchParams(params).toString()}`;
  return new NextRequest(url, { headers: { "X-Cron-Secret": "test-secret" } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SECURITY: industry_signal graceful degradation", () => {
  it("returns null industry_signal when include_industry_signal is not set", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ consent: false, hasPatterns: false }) as never,
    );
    const { GET } = await import("@/app/api/insights/generation-priors/route");
    const res = await GET(makeRequest({ company_id: COMPANY_ID, platform: PLATFORM }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.industry_signal).toBeNull();
  });

  it("returns null industry_signal (NOT 400) when consent is OFF but include_industry_signal=true", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ consent: false, hasPatterns: false }) as never,
    );
    const { GET } = await import("@/app/api/insights/generation-priors/route");
    const res = await GET(
      makeRequest({ company_id: COMPANY_ID, platform: PLATFORM, include_industry_signal: "true" }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.industry_signal).toBeNull();
  });

  it("populates industry_signal when consent is ON and include_industry_signal=true", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ consent: true, hasPatterns: true }) as never,
    );
    const { GET } = await import("@/app/api/insights/generation-priors/route");
    const res = await GET(
      makeRequest({ company_id: COMPANY_ID, platform: PLATFORM, include_industry_signal: "true" }),
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.industry_signal).not.toBeNull();
    expect(data.industry_signal.patterns).toHaveLength(1);
    expect(data.industry_signal.summary).toBeTruthy();
  });
});
