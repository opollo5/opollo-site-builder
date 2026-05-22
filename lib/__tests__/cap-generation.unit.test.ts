import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Supabase service-role mock
// ─────────────────────────────────────────────────────────────────────────────
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Performance priors mock — stub to empty so generatePost tests stay focused
// ─────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/cap/performance-priors", () => ({
  fetchPerformancePriors: vi.fn().mockResolvedValue([]),
  formatPerformancePriorsBlock: vi.fn().mockReturnValue(""),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Cost cap mock
// ─────────────────────────────────────────────────────────────────────────────
const { mockAssertCostCap } = vi.hoisted(() => ({ mockAssertCostCap: vi.fn() }));
vi.mock("@/lib/cap/cost-cap", () => ({
  assertCostCapNotExceeded: mockAssertCostCap,
  CostCapExceededError: class CostCapExceededError extends Error {
    constructor(
      public subscriptionId: string,
      public spentUsd: number,
      public capUsd: number,
    ) {
      super(`Cost cap exceeded for ${subscriptionId}`);
      this.name = "CostCapExceededError";
    }
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Provider mocks
// ─────────────────────────────────────────────────────────────────────────────
const { mockGenerateText, mockGenerateImage } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGenerateImage: vi.fn(),
}));
vi.mock("@/lib/cap/pal", () => ({
  getTextProvider: vi.fn(() => ({ generate: mockGenerateText })),
  getImageProvider: vi.fn(() => ({ generate: mockGenerateImage })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Prompt builders
// ─────────────────────────────────────────────────────────────────────────────
import {
  buildCampaignPostSystemMessage,
  buildCampaignPostUserMessage,
  PROMPT_VERSION,
} from "@/lib/cap/prompts/campaign-post";

import { buildImagePrompt, IMAGE_PROMPT_VERSION } from "@/lib/cap/prompts/image-prompt";

describe("buildCampaignPostSystemMessage", () => {
  it("returns a non-empty string", () => {
    expect(buildCampaignPostSystemMessage()).toMatch(/LinkedIn/);
  });
});

describe("buildCampaignPostUserMessage", () => {
  const base = {
    weekNumber: 1 as const,
    arcPhase: "awareness" as const,
    monthlyObjective: "Grow LinkedIn awareness for our MSP",
    month: "2026-06-01",
    tone: "professional-friendly",
    industry: "IT Services",
    targetAudience: "SMB IT managers",
    bannedWords: ["synergy", "leverage"],
    onBrandPhrases: ["peace of mind", "proactive support"],
    languagePatterns: {},
    referencePosts: [],
  };

  it("includes arc phase guidance for awareness", () => {
    const msg = buildCampaignPostUserMessage(base);
    expect(msg).toContain("AWARENESS");
    expect(msg).toContain("June 2026");
  });

  it("includes banned words section", () => {
    const msg = buildCampaignPostUserMessage(base);
    expect(msg).toContain("synergy");
    expect(msg).toContain("leverage");
  });

  it("includes on-brand phrases", () => {
    const msg = buildCampaignPostUserMessage(base);
    expect(msg).toContain("peace of mind");
  });

  it("omits banned words section when empty", () => {
    const msg = buildCampaignPostUserMessage({ ...base, bannedWords: [] });
    expect(msg).not.toContain("BANNED WORDS");
  });

  it("PROMPT_VERSION is 1", () => {
    expect(PROMPT_VERSION).toBe(1);
  });
});

describe("buildImagePrompt", () => {
  it("includes arc phase visual tone for offer", () => {
    const prompt = buildImagePrompt({
      arcPhase: "offer",
      industry: "IT Services",
      postContentSummary: "Why your MSP should act now.",
    });
    expect(prompt).toContain("action-oriented");
    expect(prompt).toContain("IT Services");
  });

  it("IMAGE_PROMPT_VERSION is 1", () => {
    expect(IMAGE_PROMPT_VERSION).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generatePost
// ─────────────────────────────────────────────────────────────────────────────
import { generatePost } from "@/lib/cap/generation/post-generator";

const SAMPLE_VOICE = {
  tone: "professional-friendly",
  industry: "IT Services",
  targetAudience: "SMB IT managers",
  bannedWords: [] as string[],
  onBrandPhrases: [] as string[],
  languagePatterns: {},
  referencePosts: [] as string[],
};

const SAMPLE_POST_INPUT = {
  campaignId: "camp-1",
  postId: "post-1",
  companyId: "company-1",
  weekNumber: 1 as const,
  arcPhase: "awareness" as const,
  monthlyObjective: "Grow LinkedIn awareness",
  month: "2026-06-01",
  voiceProfile: SAMPLE_VOICE,
};

function buildInsertChain() {
  return { insert: vi.fn().mockResolvedValue({ error: null }) };
}

describe("generatePost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(buildInsertChain());
  });

  it("happy path: parses JSON response and returns structured result", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        content: "LinkedIn post about IT challenges",
        hashtags: ["#MSP", "#ITServices", "#ManagedServices"],
      }),
      inputTokens: 200,
      outputTokens: 80,
      latencyMs: 1200,
    });

    const result = await generatePost(SAMPLE_POST_INPUT);
    expect(result.content).toBe("LinkedIn post about IT challenges");
    expect(result.hashtags).toEqual(["#MSP", "#ITServices", "#ManagedServices"]);
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(80);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.latencyMs).toBe(1200);
  });

  it("falls back gracefully when model returns non-JSON", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Here is a post about IT challenges.",
      inputTokens: 50,
      outputTokens: 20,
      latencyMs: 800,
    });

    const result = await generatePost(SAMPLE_POST_INPUT);
    expect(result.content).toBe("Here is a post about IT challenges.");
    expect(result.hashtags).toEqual([]);
  });

  it("records a generation run on success", async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: mockInsert });

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ content: "post", hashtags: [] }),
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 500,
    });

    await generatePost(SAMPLE_POST_INPUT);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "text_generation",
        status: "success",
        cap_campaign_id: "camp-1",
        cap_campaign_post_id: "post-1",
      }),
    );
  });

  it("records error run and re-throws when provider fails", async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: mockInsert });

    mockGenerateText.mockRejectedValue(new Error("Anthropic 429: rate limited"));

    await expect(generatePost(SAMPLE_POST_INPUT)).rejects.toThrow("rate limited");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateImageForPost
// ─────────────────────────────────────────────────────────────────────────────
import { generateImageForPost } from "@/lib/cap/generation/image-orchestrator";

describe("generateImageForPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue(buildInsertChain());
  });

  it("happy path returns image URL and records run", async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: mockInsert });

    mockGenerateImage.mockResolvedValue({
      url: "https://cdn.ideogram.ai/image.jpg",
      latencyMs: 2000,
    });

    const result = await generateImageForPost({
      campaignId: "camp-1",
      postId: "post-1",
      arcPhase: "awareness",
      industry: "IT Services",
      postContent: "LinkedIn post about IT challenges",
    });

    expect(result.url).toBe("https://cdn.ideogram.ai/image.jpg");
    expect(result.costUsd).toBe(0.08);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "image_generation",
        status: "success",
      }),
    );
  });

  it("records error and re-throws on failure", async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: mockInsert });

    mockGenerateImage.mockRejectedValue(new Error("Ideogram 503"));

    await expect(
      generateImageForPost({
        campaignId: "camp-1",
        postId: "post-1",
        arcPhase: "education",
        industry: "IT Services",
        postContent: "post text",
      }),
    ).rejects.toThrow("Ideogram 503");

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runCampaign
// ─────────────────────────────────────────────────────────────────────────────
import { runCampaign } from "@/lib/cap/generation/campaign-runner";

function buildCampaignDb() {
  const campaign = {
    id: "camp-1",
    month: "2026-06-01",
    monthly_objective: "Grow LinkedIn awareness",
    status: "draft",
    cap_subscription_id: "sub-1",
    cap_voice_profiles: {
      tone: "professional-friendly",
      industry: "IT Services",
      target_audience: "SMB IT managers",
      banned_words: [],
      on_brand_phrases: [],
      language_patterns: {},
      reference_posts: [],
    },
    cap_subscriptions: { id: "sub-1", company_id: "company-1" },
  };

  const upsertedPosts = [
    { id: "post-w1", week_number: 1, arc_phase: "awareness" },
    { id: "post-w2", week_number: 2, arc_phase: "education" },
    { id: "post-w3", week_number: 3, arc_phase: "offer" },
    { id: "post-w4", week_number: 4, arc_phase: "proof" },
  ];

  return { campaign, upsertedPosts };
}

describe("runCampaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCostCap.mockResolvedValue(undefined);
  });

  it("happy path: generates all 4 posts and sets status to review", async () => {
    const { campaign, upsertedPosts } = buildCampaignDb();

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ content: "post content", hashtags: ["#MSP"] }),
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 500,
    });
    mockGenerateImage.mockResolvedValue({ url: "https://cdn.ideogram.ai/img.jpg", latencyMs: 2000 });

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_campaigns") {
        callCount++;
        if (callCount === 1) {
          // First call: .select().eq().single()
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: campaign, error: null }),
              }),
            }),
          };
        }
        // Subsequent calls: .update().eq()
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      }
      if (table === "cap_campaign_posts") {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: upsertedPosts, error: null }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === "cap_generation_runs") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });

    const result = await runCampaign("camp-1");
    expect(result.status).toBe("review");
    expect(result.postsGenerated).toBe(4);
    expect(mockAssertCostCap).toHaveBeenCalledWith("sub-1");
  });

  it("throws and marks campaign failed when cost cap exceeded", async () => {
    const { campaign } = buildCampaignDb();

    let fromCallCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_campaigns") {
        fromCallCount++;
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: campaign, error: null }),
              }),
            }),
          };
        }
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      }
      return {};
    });

    mockAssertCostCap.mockRejectedValue(new Error("Cost cap exceeded"));

    await expect(runCampaign("camp-1")).rejects.toThrow("Cost cap exceeded");
  });

  it("throws when campaign not found", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
        }),
      }),
    }));

    await expect(runCampaign("nonexistent")).rejects.toThrow("Campaign not found");
  });
});
