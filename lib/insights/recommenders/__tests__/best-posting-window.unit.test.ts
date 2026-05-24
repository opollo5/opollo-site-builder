import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateBestPostingWindow } from "../best-posting-window";

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

describe("generateBestPostingWindow", () => {
  it("returns null when fewer than MIN_POSTS_FOR_RECOMMENDATION posts", async () => {
    mockRpc.mockResolvedValue({ data: Array.from({ length: 19 }, (_, i) => makePost({ bundle_post_id: `p${i}` })) });
    const result = await generateBestPostingWindow("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no posts returned", async () => {
    mockRpc.mockResolvedValue({ data: null });
    const result = await generateBestPostingWindow("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no cell has ≥12 posts (cells need min 12)", async () => {
    // 25 posts spread across many cells (1 each)
    const posts = Array.from({ length: 25 }, (_, i) =>
      makePost({ bundle_post_id: `p${i}`, day_of_week: i % 7, hour_of_day_client_tz: i % 24 })
    );
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateBestPostingWindow("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns BEST_POSTING_WINDOW when two dense cells have meaningful lift", async () => {
    // Need 50+ posts total, all recent, for sampleFactor=0.5 → score=0.5≥0.45 (moderate)
    // Cell A: Mon 9am — 25 posts, high engagement
    const cellA = Array.from({ length: 25 }, (_, i) =>
      makePost({
        bundle_post_id: `a${i}`,
        day_of_week: 1,
        hour_of_day_client_tz: 9,
        engagement_rate: 0.18,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    // Cell B: Wed 14pm — 25 posts, lower engagement
    const cellB = Array.from({ length: 25 }, (_, i) =>
      makePost({
        bundle_post_id: `b${i}`,
        day_of_week: 3,
        hour_of_day_client_tz: 14,
        engagement_rate: 0.05,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...cellA, ...cellB] });

    const result = await generateBestPostingWindow("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("BEST_POSTING_WINDOW");
    expect(result?.headline).toContain("Mon");
    expect(result?.headline).toContain("9am");
  });

  it("returns null when lift is < 1.2× (not meaningful enough)", async () => {
    // Cell A: 1.1× cell B — below threshold
    const cellA = Array.from({ length: 12 }, (_, i) =>
      makePost({ bundle_post_id: `a${i}`, day_of_week: 1, hour_of_day_client_tz: 9, engagement_rate: 0.055 })
    );
    const cellB = Array.from({ length: 12 }, (_, i) =>
      makePost({ bundle_post_id: `b${i}`, day_of_week: 2, hour_of_day_client_tz: 10, engagement_rate: 0.05 })
    );
    mockRpc.mockResolvedValue({ data: [...cellA, ...cellB] });

    const result = await generateBestPostingWindow("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("includes evidence rows referencing social_post_analytics_snapshots", async () => {
    const cellA = Array.from({ length: 25 }, (_, i) =>
      makePost({
        bundle_post_id: `a${i}`,
        day_of_week: 0,
        hour_of_day_client_tz: 8,
        engagement_rate: 0.20,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const cellB = Array.from({ length: 25 }, (_, i) =>
      makePost({
        bundle_post_id: `b${i}`,
        day_of_week: 5,
        hour_of_day_client_tz: 17,
        engagement_rate: 0.05,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...cellA, ...cellB] });

    const result = await generateBestPostingWindow("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.evidence[0].sourceTable).toBe("social_post_analytics_snapshots");
  });
});
