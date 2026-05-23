import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateBestLengthBand } from "../best-length-band";

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

const makePosts = (count: number, overrides: Record<string, unknown> = {}) =>
  Array.from({ length: count }, (_, i) => makePost({ bundle_post_id: `post-${i}`, ...overrides }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateBestLengthBand", () => {
  it("returns null when fewer than MIN_POSTS_FOR_RECOMMENDATION posts", async () => {
    mockRpc.mockResolvedValue({ data: makePosts(19) });
    const result = await generateBestLengthBand("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no posts returned", async () => {
    mockRpc.mockResolvedValue({ data: null });
    const result = await generateBestLengthBand("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when fewer than 2 valid buckets (each needs ≥5 posts)", async () => {
    // 25 posts all in medium bucket — only 1 valid bucket
    const posts = makePosts(25, { word_count: 150 });
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateBestLengthBand("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns a BEST_LENGTH_BAND recommendation when 2 buckets differ in engagement", async () => {
    // Need 50+ posts so sampleFactor = 0.5 → score = 0.5 * 1.0 * 1.0 * 1.0 = 0.5 ≥ 0.45 (moderate)
    const shortPosts = Array.from({ length: 15 }, (_, i) =>
      makePost({ bundle_post_id: `s${i}`, word_count: 80, engagement_rate: 0.12, posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString() })
    );
    const mediumPosts = Array.from({ length: 35 }, (_, i) =>
      makePost({ bundle_post_id: `m${i}`, word_count: 150, engagement_rate: 0.05, posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString() })
    );
    mockRpc.mockResolvedValue({ data: [...shortPosts, ...mediumPosts] });

    const result = await generateBestLengthBand("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("BEST_LENGTH_BAND");
    expect(result?.headline).toContain("under 100 words");
    expect(result?.successMetric).toBe("engagement_rate");
    expect(result?.evidence.length).toBeGreaterThan(0);
  });

  it("includes confidence band in returned candidate", async () => {
    const shortPosts = Array.from({ length: 10 }, (_, i) => makePost({
      bundle_post_id: `short-${i}`,
      word_count: 50,
      engagement_rate: 0.15,
      posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
    }));
    const longPosts = Array.from({ length: 50 }, (_, i) => makePost({
      bundle_post_id: `long-${i}`,
      word_count: 350,
      engagement_rate: 0.04,
      posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
    }));
    mockRpc.mockResolvedValue({ data: [...shortPosts, ...longPosts] });

    const result = await generateBestLengthBand("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.confidenceBand).toMatch(/^(strong|moderate)$/);
    expect(typeof result?.confidenceScore).toBe("number");
  });

  it("returns null when confidence is below_floor", async () => {
    // 20 posts with identical engagement_rate — lift = 0% → signalFactor = 0 → score = 0
    const posts = [
      ...makePosts(10, { word_count: 50, engagement_rate: 0.05 }),
      ...makePosts(10, { word_count: 150, engagement_rate: 0.05 }),
    ].map((p, i) => ({ ...p, bundle_post_id: `post-${i}` }));
    mockRpc.mockResolvedValue({ data: posts });

    const result = await generateBestLengthBand("company-1", "LINKEDIN", { days: 90 });
    // lift = 0, signalFactor = 0, score = 0 → below_floor → null
    expect(result).toBeNull();
  });
});
