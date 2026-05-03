import { describe, expect, it, vi, type MockedFunction } from "vitest";

import type { AnthropicCallFn } from "@/lib/anthropic-call";
import { generateCAPPosts } from "@/lib/platform/social/cap/generator";
import {
  buildSystemPrompt,
  buildUserPrompt,
  PLATFORM_CHAR_LIMITS,
} from "@/lib/platform/social/cap/prompt-builder";
import type { BrandProfile } from "@/lib/platform/brand/types";

// ---------------------------------------------------------------------------
// D1 — unit tests for the CAP copy generator.
//
// Vitest mocks isolate the Anthropic API call and the Supabase DB writes.
// All assertions run without real credentials.
// ---------------------------------------------------------------------------

vi.mock("@/lib/platform/brand/get", () => ({
  getActiveBrandProfile: vi.fn(),
}));

vi.mock("@/lib/platform/social/posts/create", () => ({
  createPostMaster: vi.fn(),
}));

vi.mock("@/lib/platform/social/variants/upsert", () => ({
  upsertVariant: vi.fn(),
}));

import { getActiveBrandProfile } from "@/lib/platform/brand/get";
import { createPostMaster } from "@/lib/platform/social/posts/create";
import { upsertVariant } from "@/lib/platform/social/variants/upsert";

const mockGetBrand = getActiveBrandProfile as MockedFunction<typeof getActiveBrandProfile>;
const mockCreate = createPostMaster as MockedFunction<typeof createPostMaster>;
const mockUpsert = upsertVariant as MockedFunction<typeof upsertVariant>;

const BASE_BRAND: BrandProfile = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  company_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  version: 1,
  is_active: true,
  change_summary: null,
  primary_colour: "#FF03A5",
  secondary_colour: null,
  accent_colour: null,
  logo_primary_url: null,
  logo_dark_url: null,
  logo_light_url: null,
  logo_icon_url: null,
  heading_font: null,
  body_font: null,
  image_style: {},
  approved_style_ids: [],
  safe_mode: false,
  personality_traits: ["friendly", "professional"],
  formality: "semi_formal",
  point_of_view: "first_person",
  preferred_vocabulary: ["innovative", "trusted"],
  avoided_terms: ["cheap", "cheap pricing"],
  voice_examples: ["We help businesses grow with confidence."],
  focus_topics: ["digital marketing", "brand strategy"],
  avoided_topics: ["politics", "religion"],
  industry: "digital marketing",
  default_approval_required: true,
  default_approval_rule: "any_one",
  platform_overrides: {},
  hashtag_strategy: "minimal",
  max_post_length: "medium",
  content_restrictions: ["No competitor mentions"],
  updated_by: null,
  created_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function makeCannedResponse(posts: { master_text: string; variants: Record<string, string> }[]) {
  const json = JSON.stringify({ posts });
  return {
    id: "msg_test",
    model: "claude-sonnet-4-6",
    content: [{ type: "text" as const, text: json }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 200 },
  };
}

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function makeStubCallFn(response: ReturnType<typeof makeCannedResponse>): AnthropicCallFn {
  return vi.fn().mockResolvedValue(response);
}

describe("buildSystemPrompt", () => {
  it("includes platform char limits in output spec", () => {
    const prompt = buildSystemPrompt(null, ["linkedin_company", "x"]);
    expect(prompt).toContain("2800");
    expect(prompt).toContain("270");
  });

  it("includes brand personality traits when brand is provided", () => {
    const prompt = buildSystemPrompt(BASE_BRAND, ["linkedin_company"]);
    expect(prompt).toContain("friendly");
    expect(prompt).toContain("professional");
  });

  it("includes avoided terms as hard constraints", () => {
    const prompt = buildSystemPrompt(BASE_BRAND, ["x"]);
    expect(prompt).toContain("cheap");
  });

  it("includes content restrictions", () => {
    const prompt = buildSystemPrompt(BASE_BRAND, ["facebook_page"]);
    expect(prompt).toContain("No competitor mentions");
  });

  it("handles null brand gracefully", () => {
    const prompt = buildSystemPrompt(null, ["linkedin_company", "facebook_page", "x"]);
    expect(prompt).toContain("Platform Rules");
    expect(prompt).toContain("Output Format");
  });
});

describe("buildUserPrompt", () => {
  it("uses supplied topics when provided", () => {
    const prompt = buildUserPrompt(BASE_BRAND, ["product launch"], 2);
    expect(prompt).toContain("product launch");
    expect(prompt).toContain("2 social media posts");
  });

  it("falls back to brand focus_topics when no topics supplied", () => {
    const prompt = buildUserPrompt(BASE_BRAND, [], 3);
    expect(prompt).toContain("digital marketing");
  });

  it("uses industry in prompt", () => {
    const prompt = buildUserPrompt(BASE_BRAND, [], 1);
    expect(prompt).toContain("digital marketing");
  });

  it("includes minimal hashtag instruction", () => {
    const prompt = buildUserPrompt(BASE_BRAND, [], 1);
    expect(prompt).toContain("1–2");
  });
});

describe("PLATFORM_CHAR_LIMITS", () => {
  it("x limit is 270", () => {
    expect(PLATFORM_CHAR_LIMITS.x).toBe(270);
  });

  it("linkedin_company limit is 2800", () => {
    expect(PLATFORM_CHAR_LIMITS.linkedin_company).toBe(2800);
  });
});

describe("generateCAPPosts", () => {
  it("returns created posts on happy path", async () => {
    mockGetBrand.mockResolvedValue(BASE_BRAND);
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        id: "post-1",
        company_id: COMPANY_ID,
        state: "draft",
        source_type: "cap",
        master_text: "Test post",
        link_url: null,
        created_by: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        state_changed_at: "2026-01-01T00:00:00Z",
        reviewer_comment: null,
      },
      timestamp: "2026-01-01T00:00:00Z",
    });
    mockUpsert.mockResolvedValue({
      ok: true,
      data: {
        id: "var-1",
        post_master_id: "post-1",
        platform: "linkedin_company",
        connection_id: null,
        variant_text: "LinkedIn version",
        is_custom: true,
        scheduled_at: null,
        media_asset_ids: [],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      timestamp: "2026-01-01T00:00:00Z",
    });

    const callFn = makeStubCallFn(makeCannedResponse([
      { master_text: "Full post text about digital marketing", variants: { linkedin_company: "LinkedIn version", x: "X version" } },
    ]));

    const result = await generateCAPPosts(
      { companyId: COMPANY_ID, platforms: ["linkedin_company", "x"], count: 1, triggeredBy: null },
      callFn,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].masterText).toBe("Full post text about digital marketing");
  });

  it("calls Claude with correct model", async () => {
    mockGetBrand.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        id: "post-2",
        company_id: COMPANY_ID,
        state: "draft",
        source_type: "cap",
        master_text: "Test",
        link_url: null,
        created_by: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        state_changed_at: "2026-01-01T00:00:00Z",
        reviewer_comment: null,
      },
      timestamp: "2026-01-01T00:00:00Z",
    });
    mockUpsert.mockResolvedValue({ ok: true, data: {} as never, timestamp: "" });

    const callFn = vi.fn().mockResolvedValue(makeCannedResponse([
      { master_text: "Test", variants: { linkedin_company: "Test LI" } },
    ])) as AnthropicCallFn;

    await generateCAPPosts({ companyId: COMPANY_ID, count: 1, triggeredBy: null }, callFn);

    expect(callFn).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-sonnet-4-6" }));
  });

  it("returns PARSE_FAILED when Claude returns non-JSON", async () => {
    mockGetBrand.mockResolvedValue(null);
    const callFn = makeStubCallFn({
      id: "msg_bad",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "Sorry, I cannot help with that." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await generateCAPPosts({ companyId: COMPANY_ID, count: 1, triggeredBy: null }, callFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARSE_FAILED");
  });

  it("returns CLAUDE_ERROR when API call throws", async () => {
    mockGetBrand.mockResolvedValue(null);
    const callFn = vi.fn().mockRejectedValue(new Error("Network error")) as AnthropicCallFn;

    const result = await generateCAPPosts({ companyId: COMPANY_ID, count: 1, triggeredBy: null }, callFn);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("CLAUDE_ERROR");
  });

  it("clamps count to MAX_COUNT (5)", async () => {
    mockGetBrand.mockResolvedValue(null);
    const posts = Array.from({ length: 3 }, (_, i) => ({
      master_text: `Post ${i + 1}`,
      variants: { linkedin_company: `LI ${i + 1}` },
    }));
    const callFn = makeStubCallFn(makeCannedResponse(posts));
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        id: "p",
        company_id: COMPANY_ID,
        state: "draft",
        source_type: "cap",
        master_text: "Post",
        link_url: null,
        created_by: null,
        created_at: "",
        updated_at: "",
        state_changed_at: "",
        reviewer_comment: null,
      },
      timestamp: "",
    });
    mockUpsert.mockResolvedValue({ ok: true, data: {} as never, timestamp: "" });

    const result = await generateCAPPosts({ companyId: COMPANY_ID, count: 99, triggeredBy: null }, callFn);

    expect(callFn).toHaveBeenCalledWith(expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("5 social media posts") }),
      ]),
    }));
    expect(result.ok).toBe(true);
  });

  it("strips markdown fences from Claude response", async () => {
    mockGetBrand.mockResolvedValue(null);
    const inner = JSON.stringify({ posts: [{ master_text: "Clean text", variants: { x: "Tweet" } }] });
    const callFn = makeStubCallFn({
      id: "msg_fence",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: `\`\`\`json\n${inner}\n\`\`\`` }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    mockCreate.mockResolvedValue({
      ok: true,
      data: {
        id: "p2",
        company_id: COMPANY_ID,
        state: "draft",
        source_type: "cap",
        master_text: "Clean text",
        link_url: null,
        created_by: null,
        created_at: "",
        updated_at: "",
        state_changed_at: "",
        reviewer_comment: null,
      },
      timestamp: "",
    });
    mockUpsert.mockResolvedValue({ ok: true, data: {} as never, timestamp: "" });

    const result = await generateCAPPosts({ companyId: COMPANY_ID, count: 1, triggeredBy: null }, callFn);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].masterText).toBe("Clean text");
  });

  it("returns VALIDATION_FAILED when no valid platforms specified", async () => {
    mockGetBrand.mockResolvedValue(null);
    const callFn = makeStubCallFn(makeCannedResponse([]));

    const result = await generateCAPPosts(
      { companyId: COMPANY_ID, platforms: [] as never, count: 1, triggeredBy: null },
      callFn,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});
