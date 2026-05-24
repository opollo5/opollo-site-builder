import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateTopicPerformance } from "../topic-performance";

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
  topic_tags: [] as string[],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateTopicPerformance", () => {
  it("returns null when fewer than MIN_POSTS_FOR_RECOMMENDATION posts", async () => {
    mockRpc.mockResolvedValue({
      data: Array.from({ length: 19 }, (_, i) =>
        makePost({ bundle_post_id: `p${i}`, topic_tags: ["leadership"] })
      ),
    });
    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no posts returned", async () => {
    mockRpc.mockResolvedValue({ data: null });
    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no posts have topic_tags", async () => {
    const posts = Array.from({ length: 25 }, (_, i) =>
      makePost({ bundle_post_id: `p${i}`, topic_tags: [] })
    );
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no topic has ≥5 posts", async () => {
    // Each topic only appears 4 times
    const posts = Array.from({ length: 20 }, (_, i) =>
      makePost({ bundle_post_id: `p${i}`, topic_tags: [`topic-${i % 5}`], engagement_rate: 0.05 })
    );
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when fewer than 2 valid topics with ≥5 posts each", async () => {
    // Only "leadership" has 6 posts; "culture" has only 2
    const posts = [
      ...Array.from({ length: 6 }, (_, i) =>
        makePost({ bundle_post_id: `l${i}`, topic_tags: ["leadership"], engagement_rate: 0.12 })
      ),
      ...Array.from({ length: 2 }, (_, i) =>
        makePost({ bundle_post_id: `c${i}`, topic_tags: ["culture"], engagement_rate: 0.05 })
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        makePost({ bundle_post_id: `x${i}`, topic_tags: [] })
      ),
    ];
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns TOPIC_PERFORMANCE when best topic outperforms median by ≥20%", async () => {
    // Need 50+ total posts for sampleFactor ≥ 0.5 → score ≥ 0.45 (moderate)
    const leadershipPosts = Array.from({ length: 10 }, (_, i) =>
      makePost({
        bundle_post_id: `l${i}`,
        topic_tags: ["leadership"],
        engagement_rate: 0.15,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const culturePosts = Array.from({ length: 10 }, (_, i) =>
      makePost({
        bundle_post_id: `c${i}`,
        topic_tags: ["culture"],
        engagement_rate: 0.06,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const hrPosts = Array.from({ length: 30 }, (_, i) =>
      makePost({
        bundle_post_id: `h${i}`,
        topic_tags: ["hr"],
        engagement_rate: 0.04,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...leadershipPosts, ...culturePosts, ...hrPosts] });

    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("TOPIC_PERFORMANCE");
    expect(result?.headline).toContain("leadership");
    expect(result?.successMetric).toBe("engagement_rate");
  });

  it("returns null when lift < 20% over median", async () => {
    const t1 = Array.from({ length: 6 }, (_, i) =>
      makePost({ bundle_post_id: `t1-${i}`, topic_tags: ["topic1"], engagement_rate: 0.07 })
    );
    const t2 = Array.from({ length: 6 }, (_, i) =>
      makePost({ bundle_post_id: `t2-${i}`, topic_tags: ["topic2"], engagement_rate: 0.065 })
    );
    const filler = Array.from({ length: 10 }, (_, i) =>
      makePost({ bundle_post_id: `f${i}`, topic_tags: [] })
    );
    mockRpc.mockResolvedValue({ data: [...t1, ...t2, ...filler] });

    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    // lift = (0.07 - 0.065) / 0.065 ≈ 7.7% < 20% → null
    expect(result).toBeNull();
  });

  it("evidence rows reference ins_post_features", async () => {
    const leadershipPosts = Array.from({ length: 10 }, (_, i) =>
      makePost({
        bundle_post_id: `l${i}`,
        topic_tags: ["leadership"],
        engagement_rate: 0.18,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const otherPosts = Array.from({ length: 40 }, (_, i) =>
      makePost({
        bundle_post_id: `o${i}`,
        topic_tags: ["generic"],
        engagement_rate: 0.04,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...leadershipPosts, ...otherPosts] });

    const result = await generateTopicPerformance("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.evidence[0].sourceTable).toBe("ins_post_features");
    expect(result?.evidence[0].summary).toContain("leadership");
  });
});
