import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateHashtagDiminishingReturns } from "../hashtag-diminishing-returns";

vi.mock("server-only", () => ({}));

const mockRpc = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({ rpc: mockRpc }),
}));

const now = Date.now();
const makePost = (overrides: Record<string, unknown> = {}) => ({
  bundle_post_id: crypto.randomUUID(),
  posted_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
  engagement_rate: 0.05,
  impressions: 200,
  word_count: 150,
  has_question: false,
  hashtag_count: 3,
  media_type: "text",
  day_of_week: 1,
  hour_of_day_client_tz: 9,
  topic_tags: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateHashtagDiminishingReturns", () => {
  it("returns null when fewer than MIN_POSTS_FOR_RECOMMENDATION posts", async () => {
    mockRpc.mockResolvedValue({
      data: Array.from({ length: 19 }, (_, i) => makePost({ bundle_post_id: `p${i}` })),
    });
    const result = await generateHashtagDiminishingReturns("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no posts returned", async () => {
    mockRpc.mockResolvedValue({ data: null });
    const result = await generateHashtagDiminishingReturns("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when fewer than 2 valid buckets (each needs ≥3 posts)", async () => {
    // All posts in "1-3" bucket
    const posts = Array.from({ length: 25 }, (_, i) =>
      makePost({ bundle_post_id: `p${i}`, hashtag_count: 2 })
    );
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateHashtagDiminishingReturns("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when engagement increases monotonically (no diminishing returns)", async () => {
    // 0 < 1-3 < 4-6 < 7+ — no inflection
    const bucket0 = Array.from({ length: 5 }, (_, i) =>
      makePost({ bundle_post_id: `b0-${i}`, hashtag_count: 0, engagement_rate: 0.03 })
    );
    const bucket1 = Array.from({ length: 5 }, (_, i) =>
      makePost({ bundle_post_id: `b1-${i}`, hashtag_count: 2, engagement_rate: 0.05 })
    );
    const bucket2 = Array.from({ length: 5 }, (_, i) =>
      makePost({ bundle_post_id: `b2-${i}`, hashtag_count: 5, engagement_rate: 0.08 })
    );
    const bucket3 = Array.from({ length: 5 }, (_, i) =>
      makePost({ bundle_post_id: `b3-${i}`, hashtag_count: 10, engagement_rate: 0.10 })
    );
    mockRpc.mockResolvedValue({ data: [...bucket0, ...bucket1, ...bucket2, ...bucket3] });
    const result = await generateHashtagDiminishingReturns("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns HASHTAG_DIMINISHING_RETURNS when 4-6 drops vs 1-3", async () => {
    // effectMagnitude = drop ≈ 0.6 (capped at 1), so need sampleFactor ≥ 0.75 (75+ posts)
    // score = 0.8 * 1.0 * 1.0 * 0.6 = 0.48 ≥ 0.45 → moderate with 80 posts
    const bucket1 = Array.from({ length: 20 }, (_, i) =>
      makePost({
        bundle_post_id: `b1-${i}`,
        hashtag_count: 2,
        engagement_rate: 0.10,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const bucket2 = Array.from({ length: 60 }, (_, i) =>
      makePost({
        bundle_post_id: `b2-${i}`,
        hashtag_count: 5,
        engagement_rate: 0.04,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...bucket1, ...bucket2] });

    const result = await generateHashtagDiminishingReturns("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("HASHTAG_DIMINISHING_RETURNS");
    expect(result?.headline).toContain("3 hashtags");
    expect(result?.successMetric).toBe("engagement_rate");
  });

  it("returns null when drop is < 10%", async () => {
    const bucket1 = Array.from({ length: 6 }, (_, i) =>
      makePost({ bundle_post_id: `b1-${i}`, hashtag_count: 2, engagement_rate: 0.055 })
    );
    const bucket2 = Array.from({ length: 20 }, (_, i) =>
      makePost({ bundle_post_id: `b2-${i}`, hashtag_count: 5, engagement_rate: 0.05 })
    );
    mockRpc.mockResolvedValue({ data: [...bucket1, ...bucket2] });

    const result = await generateHashtagDiminishingReturns("company-1", "LINKEDIN", { days: 90 });
    // drop = (0.055 - 0.05) / 0.055 ≈ 9% < 10% → null
    expect(result).toBeNull();
  });

  it("evidence references ins_post_features and shows hashtag count", async () => {
    const bucket1 = Array.from({ length: 20 }, (_, i) =>
      makePost({
        bundle_post_id: `b1-${i}`,
        hashtag_count: 1,
        engagement_rate: 0.12,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const bucket2 = Array.from({ length: 60 }, (_, i) =>
      makePost({
        bundle_post_id: `b2-${i}`,
        hashtag_count: 8,
        engagement_rate: 0.04,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...bucket1, ...bucket2] });

    const result = await generateHashtagDiminishingReturns("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.evidence[0].sourceTable).toBe("ins_post_features");
    expect(result?.evidence[0].summary).toContain("hashtags");
  });
});
