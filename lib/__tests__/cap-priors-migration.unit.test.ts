import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/cap/performance-priors", () => ({
  fetchPerformancePriors: vi.fn().mockResolvedValue([
    { engagementRate: 0.08, content: "Test post content" },
  ]),
  formatPerformancePriorsBlock: vi.fn().mockReturnValue("PERFORMANCE PRIORS\n\n1. [8.0%] — Test post content"),
}));
vi.mock("@/lib/cap/pal", () => ({ getTextProvider: vi.fn() }));
vi.mock("@/lib/cap/pal/cost-tracker", () => ({ calculateAnthropicCost: vi.fn().mockReturnValue(0.001) }));
vi.mock("@/lib/cap/generation/sanitize", () => ({
  sanitizePromptInput: vi.fn((s: string) => s),
  sanitizePromptArray: vi.fn((a: string[]) => a),
}));
vi.mock("@/lib/cap/prompts/campaign-post", () => ({
  PROMPT_VERSION: 1,
  buildCampaignPostSystemMessage: vi.fn().mockReturnValue("system"),
  buildCampaignPostUserMessage: vi.fn().mockReturnValue("user"),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { fetchPerformancePriors, formatPerformancePriorsBlock } from "@/lib/cap/performance-priors";
import { getServiceRoleClient } from "@/lib/supabase";

const mockGetSvc = vi.mocked(getServiceRoleClient);
const mockFetchPriors = vi.mocked(fetchPerformancePriors);
const mockFormatBlock = vi.mocked(formatPerformancePriorsBlock);

function makeInsert() {
  return vi.fn().mockResolvedValue({ data: null, error: null });
}

function setupSvc() {
  const chain = {
    from: vi.fn(),
    insert: makeInsert(),
  };
  chain.from.mockReturnValue(chain);
  mockGetSvc.mockReturnValue(chain as never);
  return chain;
}

const MOCK_INPUT = {
  campaignId: "campaign-1",
  postId: "post-1",
  companyId: "company-1",
  weekNumber: 1 as const,
  arcPhase: "awareness" as const,
  monthlyObjective: "Grow LinkedIn engagement",
  month: "June 2026",
  voiceProfile: {
    tone: "professional",
    industry: "MSP",
    targetAudience: "IT managers",
    bannedWords: [],
    onBrandPhrases: [],
    languagePatterns: {},
    referencePosts: [],
  },
};

describe("CAP post-generator — priors migration feature flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.INSIGHTS_PRIORS_VIA_API;
  });

  afterEach(() => {
    delete process.env.INSIGHTS_PRIORS_VIA_API;
  });

  it("uses direct DB query when flag is OFF", async () => {
    process.env.INSIGHTS_PRIORS_VIA_API = "false";
    setupSvc();

    const { getTextProvider } = await import("@/lib/cap/pal");
    vi.mocked(getTextProvider).mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({ content: "Generated content", hashtags: [] }),
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 200,
      }),
    } as never);

    const { generatePost } = await import("@/lib/cap/generation/post-generator");
    await generatePost(MOCK_INPUT);

    expect(mockFetchPriors).toHaveBeenCalledWith("company-1");
    expect(mockFormatBlock).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls insights API when flag is ON", async () => {
    process.env.INSIGHTS_PRIORS_VIA_API = "true";
    process.env.CRON_SECRET = "test-secret";
    setupSvc();

    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ priors_text: "API priors block" }),
    });

    const { getTextProvider } = await import("@/lib/cap/pal");
    vi.mocked(getTextProvider).mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({ content: "Generated content", hashtags: [] }),
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 200,
      }),
    } as never);

    const { generatePost } = await import("@/lib/cap/generation/post-generator");
    await generatePost(MOCK_INPUT);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/insights/generation-priors"),
      expect.objectContaining({
        headers: { "X-Cron-Secret": "test-secret" },
      }),
    );
    expect(mockFetchPriors).not.toHaveBeenCalled();
  });

  it("falls back to direct DB when API returns non-2xx", async () => {
    process.env.INSIGHTS_PRIORS_VIA_API = "true";
    setupSvc();

    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    const { getTextProvider } = await import("@/lib/cap/pal");
    vi.mocked(getTextProvider).mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({ content: "Generated content", hashtags: [] }),
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 200,
      }),
    } as never);

    const { generatePost } = await import("@/lib/cap/generation/post-generator");
    await generatePost(MOCK_INPUT);

    expect(mockFetchPriors).toHaveBeenCalledWith("company-1");
  });

  it("falls back to direct DB when API call throws", async () => {
    process.env.INSIGHTS_PRIORS_VIA_API = "true";
    setupSvc();

    mockFetch.mockRejectedValue(new Error("Connection timeout"));

    const { getTextProvider } = await import("@/lib/cap/pal");
    vi.mocked(getTextProvider).mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        text: JSON.stringify({ content: "Generated content", hashtags: [] }),
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 200,
      }),
    } as never);

    const { generatePost } = await import("@/lib/cap/generation/post-generator");
    await generatePost(MOCK_INPUT);

    expect(mockFetchPriors).toHaveBeenCalledWith("company-1");
  });
});
