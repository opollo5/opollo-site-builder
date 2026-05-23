import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateMediaTypeLift } from "../media-type-lift";

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

describe("generateMediaTypeLift", () => {
  it("returns null when fewer than MIN_POSTS_FOR_RECOMMENDATION posts", async () => {
    mockRpc.mockResolvedValue({
      data: Array.from({ length: 19 }, (_, i) => makePost({ bundle_post_id: `p${i}` })),
    });
    const result = await generateMediaTypeLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no posts returned", async () => {
    mockRpc.mockResolvedValue({ data: null });
    const result = await generateMediaTypeLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when only 1 media type has ≥5 posts", async () => {
    const posts = Array.from({ length: 25 }, (_, i) =>
      makePost({ bundle_post_id: `p${i}`, media_type: "video" })
    );
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateMediaTypeLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns MEDIA_TYPE_LIFT when two types differ by ≥10%", async () => {
    // Need 50+ total posts for sampleFactor ≥ 0.5 → score ≥ 0.45 (moderate)
    const videoPosts = Array.from({ length: 15 }, (_, i) =>
      makePost({
        bundle_post_id: `v${i}`,
        media_type: "video",
        engagement_rate: 0.12,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const textPosts = Array.from({ length: 35 }, (_, i) =>
      makePost({
        bundle_post_id: `t${i}`,
        media_type: "text",
        engagement_rate: 0.05,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...videoPosts, ...textPosts] });

    const result = await generateMediaTypeLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("MEDIA_TYPE_LIFT");
    expect(result?.headline).toContain("Video");
    expect(result?.successMetric).toBe("engagement_rate");
  });

  it("returns null when lift is < 10%", async () => {
    const videoPosts = Array.from({ length: 8 }, (_, i) =>
      makePost({ bundle_post_id: `v${i}`, media_type: "video", engagement_rate: 0.053 })
    );
    const textPosts = Array.from({ length: 15 }, (_, i) =>
      makePost({ bundle_post_id: `t${i}`, media_type: "text", engagement_rate: 0.05 })
    );
    mockRpc.mockResolvedValue({ data: [...videoPosts, ...textPosts] });

    const result = await generateMediaTypeLift("company-1", "LINKEDIN", { days: 90 });
    // lift = (0.053 - 0.05) / 0.05 = 6% < 10% → null
    expect(result).toBeNull();
  });

  it("evidence rows reference social_post_analytics_snapshots", async () => {
    const imagePosts = Array.from({ length: 15 }, (_, i) =>
      makePost({
        bundle_post_id: `img${i}`,
        media_type: "image",
        engagement_rate: 0.14,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const textPosts = Array.from({ length: 35 }, (_, i) =>
      makePost({
        bundle_post_id: `txt${i}`,
        media_type: "text",
        engagement_rate: 0.04,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...imagePosts, ...textPosts] });

    const result = await generateMediaTypeLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.evidence[0].sourceTable).toBe("social_post_analytics_snapshots");
  });
});
