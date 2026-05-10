import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract.
//
// Pins the exact payload we send to the Anthropic Messages API from
// callAnthropic(). Snapshot changes require review the same way schema
// migrations do. If the system prompt, model name, max_tokens, or
// cache_control shape changes, this diff will be visible in the PR.
//
// Mock boundary: @anthropic-ai/sdk (network edge). The Langfuse tracer
// is also mocked to keep the test hermetic.
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  // Must use a regular function (not arrow) so `new Anthropic()` works.
  default: vi.fn(function () {
    return { messages: { create: mockCreate } };
  }),
}));

vi.mock("@/lib/langfuse", () => ({
  traceAnthropicCall: () => ({
    traceId: null,
    end: vi.fn(),
    fail: vi.fn(),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildSystemPrompt, callAnthropic } from "@/lib/ai-prefill";

const STUB_RESPONSE = {
  id: "msg_contract_test",
  model: "claude-haiku-4-5-20251001",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        title: "Test Title",
        content: "Test content.",
        seo_title: "Test SEO Title",
        meta_description: "Test meta description.",
        slug: "test-title",
        categories: [{ name: "Marketing", isNew: false }],
        tags: [{ name: "seo", isNew: false }],
        excerpt: null,
      }),
    },
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
};

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue(STUB_RESPONSE);
  process.env.ANTHROPIC_API_KEY = "test-api-key";
});

describe("CONTRACT: Anthropic ai-prefill request shape", () => {
  it("[snapshot] messages.create payload is stable", async () => {
    await callAnthropic(
      "Sample document text for contract test.",
      ["Marketing", "SEO"],
      ["seo", "content"],
    );

    expect(mockCreate).toHaveBeenCalledOnce();
    const [args] = mockCreate.mock.calls[0] as [Record<string, unknown>];

    // Snapshot the stable, reviewable fields.
    expect({
      model: args.model,
      max_tokens: args.max_tokens,
      system: args.system,
    }).toMatchSnapshot();
  });

  it("system prompt has cache_control: ephemeral on the text block", async () => {
    await callAnthropic("doc", [], []);
    const [args] = mockCreate.mock.calls[0] as [
      { system: Array<{ type: string; cache_control: { type: string } }> },
    ];
    expect(args.system[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("user message includes the document and both taxonomy lists", async () => {
    await callAnthropic("My document text.", ["Cat A"], ["tag-b"]);
    const [args] = mockCreate.mock.calls[0] as [
      { messages: Array<{ role: string; content: string }> },
    ];
    const content = args.messages[0]?.content ?? "";
    expect(content).toContain("My document text.");
    expect(content).toContain('"Cat A"');
    expect(content).toContain('"tag-b"');
  });

  it("buildSystemPrompt output is stable", () => {
    expect(buildSystemPrompt()).toMatchSnapshot();
  });

  it("strips code fences from model response before JSON.parse", async () => {
    mockCreate.mockResolvedValueOnce({
      ...STUB_RESPONSE,
      content: [
        {
          type: "text",
          text: "```json\n{\"title\":\"Fenced\",\"content\":\"\",\"seo_title\":null,\"meta_description\":null,\"slug\":null,\"categories\":[],\"tags\":[],\"excerpt\":null}\n```",
        },
      ],
    });
    const result = await callAnthropic("doc", [], []);
    expect(result.title).toBe("Fenced");
  });

  it("returns empty-safe result when model emits unparseable JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      ...STUB_RESPONSE,
      content: [{ type: "text", text: "not json at all" }],
    });
    const result = await callAnthropic("doc", [], []);
    expect(result.title).toBeNull();
    expect(result.content).toBe("");
    expect(result.categories).toEqual([]);
    expect(result.tags).toEqual([]);
  });
});
