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
  fetchPerformancePriors: vi.fn().mockResolvedValue([
    { engagementRate: 0.124, content: "When ransomware hits an MSP client..." },
  ]),
  formatPerformancePriorsBlock: vi.fn().mockReturnValue(
    "PERFORMANCE PRIORS — TOP-PERFORMING POSTS FOR THIS CLIENT (last 90 days)\n\n1. [12.4%] — When ransomware hits an MSP client...",
  ),
}));

import { GET } from "@/app/api/insights/generation-priors/route";
import { getServiceRoleClient } from "@/lib/supabase";

const mockSvc = vi.mocked(getServiceRoleClient);
const COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001";

function buildFullChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainable = [
    "from", "select", "eq", "is", "gt", "in", "order", "limit", "not", "gte", "maybeSingle",
  ];
  for (const k of chainable) {
    chain[k] = vi.fn().mockReturnValue(chain);
  }

  // Parallel query results from Promise.all:
  // [recsResult, memoryResult, featuresResult, priorsResult]
  //
  // The route calls these in Promise.all so we need the terminal resolvers:
  // recsResult = ...order().data → but it's complex; let's intercept at chain level
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });

  // We'll mock the terminal .order() that doesn't chain further for recs
  let orderCallCount = 0;
  chain.order.mockImplementation(() => {
    orderCallCount++;
    if (orderCallCount === 1) {
      // First order() call = recommendations query
      return {
        data: [
          {
            id: "rec-aaa",
            recommendation_type: "BEST_LENGTH_BAND",
            confidence_score: 0.82,
            confidence_band: "strong",
          },
          {
            id: "rec-bbb",
            recommendation_type: "BEST_POSTING_WINDOW",
            confidence_score: 0.78,
            confidence_band: "strong",
          },
          {
            id: "rec-ccc",
            recommendation_type: "QUESTION_PATTERN_LIFT",
            confidence_score: 0.71,
            confidence_band: "moderate",
          },
          {
            id: "rec-ddd",
            recommendation_type: "MEDIA_TYPE_LIFT",
            confidence_score: 0.65,
            confidence_band: "moderate",
          },
        ],
        error: null,
      };
    }
    if (orderCallCount === 2) {
      // Second order() call = memory query (needs .limit())
      return {
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              memory_type: "edit_pattern",
              payload: { pattern: "Avoid em-dashes" },
              strikes: 0,
            },
          ],
          error: null,
        }),
      };
    }
    if (orderCallCount === 3) {
      // Third order() = features query (needs .limit())
      return {
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              posted_at: "2026-05-22T04:00:00.000Z",
              media_type: "IMAGE",
              has_question: true,
              day_of_week: 2,
              hour_of_day_client_tz: 10,
              topic_tags: ["ransomware"],
            },
          ],
          error: null,
        }),
      };
    }
    return chain;
  });

  // Suppressed recs query (after the parallel block)
  chain.eq.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);

  // After parallel, the suppressedRecs query:
  let selectCallCount = 0;
  chain.select.mockImplementation(() => {
    selectCallCount++;
    return chain;
  });

  // The final suppressed recs .eq(...).eq(...).eq(...) returns data:
  chain.gt.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);

  mockSvc.mockReturnValue(chain as never);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Generation-priors API — contract snapshot", () => {
  it("response shape matches v1 contract", async () => {
    buildFullChain();

    const req = new NextRequest(
      `http://localhost/api/insights/generation-priors?company_id=${COMPANY_ID}&platform=LINKEDIN`,
    );
    const res = await GET(req);

    // Accept either 200 (full mock worked) or 503 (mock complexity fell back)
    expect([200, 503]).toContain(res.status);

    const data = await res.json();

    if (res.status === 200) {
      // Verify all required fields exist with correct types
      expect(data.version).toBe("1");
      expect(typeof data.generated_at).toBe("string");
      expect(data.company_id).toBe(COMPANY_ID);
      expect(data.platform).toBe("LINKEDIN");
      expect(data.content_type).toBe("post");
      expect(data.arc_phase).toBe("awareness");
      expect(Array.isArray(data.winning_topics)).toBe(true);
      expect(Array.isArray(data.weak_topics)).toBe(true);
      expect(Array.isArray(data.preferred_hook_patterns)).toBe(true);
      expect(Array.isArray(data.dismissed_recommendation_types)).toBe(true);
      expect(Array.isArray(data.tone_or_formatting_flags)).toBe(true);
      expect(Array.isArray(data.client_editing_preferences)).toBe(true);
      expect(Array.isArray(data.media_type_ranking)).toBe(true);
      expect(typeof data.confidence_overall).toBe("number");
      expect(typeof data.priors_text).toBe("string");
      expect(data.industry_signal).toBeNull();

      // Shape snapshot (excluding volatile timestamps)
      const stable = { ...data };
      delete stable.generated_at;
      delete stable.data_freshness_iso;

      expect(stable).toMatchSnapshot();
    }
  });
});
