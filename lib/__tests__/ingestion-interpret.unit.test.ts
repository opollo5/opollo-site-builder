import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Dependency-inject Anthropic via the function param (no global mock needed
// for the call itself); the brand-profile reader is a Supabase read that we
// mock at the module boundary.
const { mockGetBrandProfile } = vi.hoisted(() => ({ mockGetBrandProfile: vi.fn() }));
vi.mock("@/lib/platform/brand/get", () => ({
  getActiveBrandProfile: mockGetBrandProfile,
}));

import { interpretPosts } from "@/lib/ingestion/interpret";
import type { PostRow } from "@/lib/ingestion/xlsx-parse";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

const ROW: PostRow = {
  sourceRow: 2,
  post_topic: "AI in marketing",
  headline_text: "How AI changes marketing",
  body_text: "Long body text here.",
  target_platforms: ["linkedin", "instagram"],
};

function brandProfile(overrides: Partial<{ approved_style_ids: string[]; safe_mode: boolean; primary_colour: string }> = {}) {
  return {
    approved_style_ids: ["clean_corporate", "bold_promo"],
    safe_mode: false,
    primary_colour: "#1A56DB",
    ...overrides,
  };
}

function makeAnthropicStub(responsePosts: Array<Record<string, unknown>>): (req: unknown) => Promise<{
  id: string;
  model: string;
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}> {
  return async () => ({
    id: "msg_stub",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: JSON.stringify({ posts: responsePosts }) }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBrandProfile.mockResolvedValue(brandProfile());
});

describe("interpretPosts — happy path", () => {
  it("returns one InterpretedPost per input row with derived aspect_ratios", async () => {
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "AI is reshaping how marketers operate.",
        style_id: "clean_corporate",
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "How AI changes marketing",
      },
    ]);

    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].image_brief.aspect_ratios).toEqual(["1x1", "4x5"]); // linkedin → 1x1, instagram → 4x5
    expect(result.posts[0].image_brief.target_platforms).toEqual(["linkedin", "instagram"]);
    expect(result.posts[0].image_brief.style_id).toBe("clean_corporate");
    expect(result.posts[0].image_brief.composition_type).toBe("split_layout");
    expect(result.posts[0].image_brief.primary_colour).toBe("#1A56DB");
    expect(result.posts[0].post_text).toBe("AI is reshaping how marketers operate.");
  });

  it("dedupes aspect ratios across platforms (linkedin + facebook both 1x1 → 1 ratio)", async () => {
    const row: PostRow = { ...ROW, target_platforms: ["linkedin", "facebook"] };
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "clean_corporate",
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "Head",
      },
    ]);

    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [row],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].image_brief.aspect_ratios).toEqual(["1x1"]);
  });
});

describe("interpretPosts — row hint overrides", () => {
  it("row.style_hint overrides AI's choice", async () => {
    const row: PostRow = { ...ROW, style_hint: "bold_promo" };
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "clean_corporate", // AI picked this; row hint says bold_promo
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "Head",
      },
    ]);

    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [row],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].image_brief.style_id).toBe("bold_promo"); // row hint wins
  });

  it("row.composition_hint overrides AI's choice", async () => {
    const row: PostRow = { ...ROW, composition_hint: "gradient_fade" };
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "clean_corporate",
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "Head",
      },
    ]);

    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [row],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].image_brief.composition_type).toBe("gradient_fade");
  });

  it("headline_text is taken verbatim from the row (not the AI's response)", async () => {
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "clean_corporate",
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "AI-rewritten different headline",
      },
    ]);
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].image_brief.headline_text).toBe("How AI changes marketing");
  });
});

describe("interpretPosts — brand profile constraints", () => {
  it("AI style outside approved_style_ids → rejects with source_row", async () => {
    mockGetBrandProfile.mockResolvedValue(brandProfile({ approved_style_ids: ["clean_corporate"] }));
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "editorial", // not in approved set
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "Head",
      },
    ]);

    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/row 2.*editorial/);
    expect(result.details?.sourceRow).toBe(2);
  });

  it("no brand profile → defaults to full enum set (any style allowed)", async () => {
    mockGetBrandProfile.mockResolvedValue(null);
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "editorial",
        composition_type: "texture",
        primary_colour: "#FF03A5",
        headline_text: "Head",
      },
    ]);
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].image_brief.style_id).toBe("editorial");
  });

  it("brand approved_style_ids list contains only invalid values → rejects upfront", async () => {
    mockGetBrandProfile.mockResolvedValue(
      brandProfile({ approved_style_ids: ["not_a_real_style"] }),
    );
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: makeAnthropicStub([]) as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no approved styles/);
  });
});

describe("interpretPosts — error paths", () => {
  it("Anthropic returns invalid JSON → rejects", async () => {
    const call: (req: unknown) => Promise<{ id: string; model: string; content: Array<{ type: "text"; text: string }>; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } }> = async () => ({
      id: "msg_stub",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "this is not JSON at all" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not valid JSON/);
  });

  it("Anthropic response missing posts array → schema error", async () => {
    const call: (req: unknown) => Promise<{ id: string; model: string; content: Array<{ type: "text"; text: string }>; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } }> = async () => ({
      id: "msg_stub",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: JSON.stringify({ unrelated: "shape" }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/schema validation/);
  });

  it("Anthropic returns post for unknown source_row → rejects", async () => {
    const call = makeAnthropicStub([
      {
        source_row: 99, // not in input
        post_text: "Body",
        style_id: "clean_corporate",
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "Head",
      },
    ]);
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/source_row=99/);
  });

  it("Anthropic call throws → returns error result, never throws", async () => {
    const call: (req: unknown) => Promise<never> = async () => {
      throw new Error("rate limited");
    };
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Anthropic call failed.*rate limited/);
  });

  it("Anthropic returns fewer posts than asked → rejects", async () => {
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "clean_corporate",
        composition_type: "split_layout",
        primary_colour: "#1A56DB",
        headline_text: "Head",
      },
    ]);
    const rows = [ROW, { ...ROW, sourceRow: 3, post_topic: "second" }];
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: rows,
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Anthropic returned 1 post for source_row=2, but row 3 was never returned → row lookup miss
    expect(result.error).toMatch(/1 posts.*expected 2/);
  });

  it("empty input → rejects", async () => {
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [],
      anthropicCall: makeAnthropicStub([]) as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/No posts to interpret/);
  });
});

describe("interpretPosts — primary_colour validation", () => {
  it("non-hex primary_colour from AI → schema error", async () => {
    const call = makeAnthropicStub([
      {
        source_row: 2,
        post_text: "Body",
        style_id: "clean_corporate",
        composition_type: "split_layout",
        primary_colour: "blue", // not hex
        headline_text: "Head",
      },
    ]);
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/schema validation/);
  });
});

describe("interpretPosts — fenced JSON tolerance", () => {
  it("AI wrapping output in ```json fences still parses", async () => {
    const call: (req: unknown) => Promise<{ id: string; model: string; content: Array<{ type: "text"; text: string }>; stop_reason: string | null; usage: { input_tokens: number; output_tokens: number } }> = async () => ({
      id: "msg_stub",
      model: "claude-sonnet-4-6",
      content: [
        {
          type: "text",
          text: "```json\n" + JSON.stringify({
            posts: [
              {
                source_row: 2,
                post_text: "Body",
                style_id: "clean_corporate",
                composition_type: "split_layout",
                primary_colour: "#1A56DB",
                headline_text: "Head",
              },
            ],
          }) + "\n```",
        },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const result = await interpretPosts({
      companyId: COMPANY_ID,
      posts: [ROW],
      anthropicCall: call as never,
    });
    expect(result.ok).toBe(true);
  });
});
