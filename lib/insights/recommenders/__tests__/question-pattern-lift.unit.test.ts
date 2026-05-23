import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateQuestionPatternLift } from "../question-pattern-lift";

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

describe("generateQuestionPatternLift", () => {
  it("returns null when fewer than MIN_POSTS_FOR_RECOMMENDATION posts", async () => {
    mockRpc.mockResolvedValue({
      data: Array.from({ length: 19 }, (_, i) => makePost({ bundle_post_id: `p${i}` })),
    });
    const result = await generateQuestionPatternLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when no posts returned", async () => {
    mockRpc.mockResolvedValue({ data: null });
    const result = await generateQuestionPatternLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when fewer than 5 posts in either group", async () => {
    // Only 3 posts with questions — below threshold
    const posts = [
      ...Array.from({ length: 3 }, (_, i) =>
        makePost({ bundle_post_id: `q${i}`, has_question: true, engagement_rate: 0.15 })
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        makePost({ bundle_post_id: `n${i}`, has_question: false, engagement_rate: 0.05 })
      ),
    ];
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateQuestionPatternLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).toBeNull();
  });

  it("returns null when lift is < 1.5×", async () => {
    const posts = [
      ...Array.from({ length: 10 }, (_, i) =>
        makePost({ bundle_post_id: `q${i}`, has_question: true, engagement_rate: 0.065 })
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        makePost({ bundle_post_id: `n${i}`, has_question: false, engagement_rate: 0.05 })
      ),
    ];
    mockRpc.mockResolvedValue({ data: posts });
    const result = await generateQuestionPatternLift("company-1", "LINKEDIN", { days: 90 });
    // lift = 0.065/0.05 = 1.3× < 1.5 → null
    expect(result).toBeNull();
  });

  it("returns QUESTION_PATTERN_LIFT when lift ≥ 1.5×", async () => {
    // Need 50+ total posts for sampleFactor ≥ 0.5 → score ≥ 0.45 (moderate)
    const withQ = Array.from({ length: 15 }, (_, i) =>
      makePost({
        bundle_post_id: `q${i}`,
        has_question: true,
        engagement_rate: 0.15,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const withoutQ = Array.from({ length: 35 }, (_, i) =>
      makePost({
        bundle_post_id: `n${i}`,
        has_question: false,
        engagement_rate: 0.05,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...withQ, ...withoutQ] });

    const result = await generateQuestionPatternLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.type).toBe("QUESTION_PATTERN_LIFT");
    expect(result?.headline).toMatch(/3\.0×/);
    expect(result?.body).toContain("15 posts with questions");
  });

  it("evidence rows reference ins_post_features", async () => {
    const withQ = Array.from({ length: 15 }, (_, i) =>
      makePost({
        bundle_post_id: `q${i}`,
        has_question: true,
        engagement_rate: 0.18,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    const withoutQ = Array.from({ length: 35 }, (_, i) =>
      makePost({
        bundle_post_id: `n${i}`,
        has_question: false,
        engagement_rate: 0.05,
        posted_at: new Date(now - i * 24 * 60 * 60 * 1000).toISOString(),
      })
    );
    mockRpc.mockResolvedValue({ data: [...withQ, ...withoutQ] });

    const result = await generateQuestionPatternLift("company-1", "LINKEDIN", { days: 90 });
    expect(result).not.toBeNull();
    expect(result?.evidence[0].sourceTable).toBe("ins_post_features");
  });
});
