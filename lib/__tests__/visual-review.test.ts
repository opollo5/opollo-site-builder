import { describe, expect, it } from "vitest";

import type {
  AnthropicCallFn,
  AnthropicRequest,
  AnthropicResponse,
} from "@/lib/anthropic-call";
import {
  VisualCritiqueSchema,
  critiqueBriefPageVisually,
  hasSeverityHighIssues,
  resolvePerPageCeilingCents,
  runOneVisualIteration,
  wouldExceedPageCeiling,
  BRIEF_PAGE_COST_CEILING_CENTS,
  type VisualRenderFn,
  type VisualRenderResult,
} from "@/lib/visual-review";

// ---------------------------------------------------------------------------
// M12-4 unit tests for lib/visual-review.ts.
//
// No DB, no chromium. The render + anthropic call are DI seams; tests
// exercise the parse / cap-math / cleanup contract in isolation.
// ---------------------------------------------------------------------------

describe("VisualCritiqueSchema", () => {
  it("parses a minimal critique with no issues", () => {
    const res = VisualCritiqueSchema.safeParse({ issues: [] });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.issues).toEqual([]);
      expect(res.data.overall_notes).toBe("");
    }
  });

  it("parses a populated critique", () => {
    const res = VisualCritiqueSchema.safeParse({
      issues: [
        {
          category: "contrast",
          severity: "high",
          note: "Body copy fails WCAG AA on the CTA button.",
        },
        { category: "whitespace", severity: "low", note: "Hero padding tight." },
      ],
      overall_notes: "Overall tight but contrast must be fixed.",
    });
    expect(res.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const res = VisualCritiqueSchema.safeParse({
      issues: [{ category: "typography", severity: "high", note: "x" }],
    });
    expect(res.success).toBe(false);
  });

  it("rejects a note that exceeds the length cap", () => {
    const res = VisualCritiqueSchema.safeParse({
      issues: [
        { category: "layout", severity: "high", note: "x".repeat(501) },
      ],
    });
    expect(res.success).toBe(false);
  });
});

describe("hasSeverityHighIssues", () => {
  it("returns true when any issue is high", () => {
    expect(
      hasSeverityHighIssues({
        issues: [
          { category: "layout", severity: "low", note: "ok" },
          { category: "contrast", severity: "high", note: "oops" },
        ],
        overall_notes: "",
      }),
    ).toBe(true);
  });
  it("returns false when all issues are low", () => {
    expect(
      hasSeverityHighIssues({
        issues: [{ category: "whitespace", severity: "low", note: "tight" }],
        overall_notes: "",
      }),
    ).toBe(false);
  });
  it("returns false on empty issues", () => {
    expect(hasSeverityHighIssues({ issues: [], overall_notes: "" })).toBe(false);
  });
});

describe("resolvePerPageCeilingCents", () => {
  it("returns the lib default when tenant override is null", () => {
    expect(resolvePerPageCeilingCents(null)).toBe(BRIEF_PAGE_COST_CEILING_CENTS);
  });
  it("returns the tenant override when set + positive", () => {
    expect(resolvePerPageCeilingCents(400)).toBe(400);
  });
  it("falls back to default when override is 0 or negative (defence-in-depth)", () => {
    expect(resolvePerPageCeilingCents(0)).toBe(BRIEF_PAGE_COST_CEILING_CENTS);
    expect(resolvePerPageCeilingCents(-1)).toBe(BRIEF_PAGE_COST_CEILING_CENTS);
  });
});

describe("wouldExceedPageCeiling", () => {
  it("false when projected fits", () => {
    expect(
      wouldExceedPageCeiling({
        currentPageCostCents: 100,
        projectedIterationCostCents: 50,
        ceilingCents: 200,
      }),
    ).toBe(false);
  });
  it("false at exact ceiling", () => {
    expect(
      wouldExceedPageCeiling({
        currentPageCostCents: 150,
        projectedIterationCostCents: 50,
        ceilingCents: 200,
      }),
    ).toBe(false);
  });
  it("true when projected pushes over", () => {
    expect(
      wouldExceedPageCeiling({
        currentPageCostCents: 180,
        projectedIterationCostCents: 30,
        ceilingCents: 200,
      }),
    ).toBe(true);
  });
});

function makeStubCritiqueCall(jsonPayload: unknown | string): AnthropicCallFn {
  return async (_req: AnthropicRequest): Promise<AnthropicResponse> => {
    const text =
      typeof jsonPayload === "string"
        ? jsonPayload
        : "```json\n" + JSON.stringify(jsonPayload) + "\n```";
    return {
      id: "stub",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 30 },
    };
  };
}

const ONE_BYTE_PNG_BASE64 = Buffer.from([0x89]).toString("base64");

const RENDER_RESULT: VisualRenderResult = {
  viewport_png_base64: ONE_BYTE_PNG_BASE64,
  full_page_png_base64: ONE_BYTE_PNG_BASE64,
  viewport_bytes: 1,
  full_page_bytes: 1,
};

describe("critiqueBriefPageVisually", () => {
  it("parses a well-formed fenced-json critique", async () => {
    const call = makeStubCritiqueCall({
      issues: [
        { category: "layout", severity: "high", note: "Hero collapses." },
      ],
      overall_notes: "Fix the hero.",
    });
    const res = await critiqueBriefPageVisually({
      call,
      model: "claude-sonnet-4-6",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      render: RENDER_RESULT,
      idempotencyKey: "brief:abc:p0:visual_critique:0",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.critique.issues).toHaveLength(1);
      expect(res.critique.issues[0]!.severity).toBe("high");
    }
  });

  it("returns CRITIQUE_PARSE_FAILED when the response contains no JSON", async () => {
    const call = makeStubCritiqueCall(
      "This is just prose with no json fence.",
    );
    const res = await critiqueBriefPageVisually({
      call,
      model: "claude-sonnet-4-6",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      render: RENDER_RESULT,
      idempotencyKey: "brief:abc:p0:visual_critique:0",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CRITIQUE_PARSE_FAILED");
  });

  it("returns CRITIQUE_PARSE_FAILED when JSON fails schema validation", async () => {
    const call = makeStubCritiqueCall({
      issues: [{ category: "typography", severity: "high", note: "x" }],
    });
    const res = await critiqueBriefPageVisually({
      call,
      model: "claude-sonnet-4-6",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      render: RENDER_RESULT,
      idempotencyKey: "brief:abc:p0:visual_critique:0",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CRITIQUE_PARSE_FAILED");
  });

  it("carries the idempotency key through to the call", async () => {
    const requests: AnthropicRequest[] = [];
    const call: AnthropicCallFn = async (req) => {
      requests.push(req);
      return {
        id: "stub",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "```json\n{\"issues\":[]}\n```" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    await critiqueBriefPageVisually({
      call,
      model: "claude-sonnet-4-6",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      render: RENDER_RESULT,
      idempotencyKey: "brief:X:p0:visual_critique:1",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.idempotency_key).toBe("brief:X:p0:visual_critique:1");
  });

  it("passes both screenshots as image blocks", async () => {
    const requests: AnthropicRequest[] = [];
    const call: AnthropicCallFn = async (req) => {
      requests.push(req);
      return {
        id: "stub",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "```json\n{\"issues\":[]}\n```" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    await critiqueBriefPageVisually({
      call,
      model: "claude-sonnet-4-6",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      render: RENDER_RESULT,
      idempotencyKey: "brief:X:p0:visual_critique:0",
    });
    const content = requests[0]!.messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      const imageBlocks = content.filter((c) => c.type === "image");
      expect(imageBlocks).toHaveLength(2);
    }
  });
});

describe("runOneVisualIteration", () => {
  it("invokes render before critique and returns ok on success", async () => {
    const order: string[] = [];
    const render: VisualRenderFn = async () => {
      order.push("render");
      return RENDER_RESULT;
    };
    const call: AnthropicCallFn = async () => {
      order.push("call");
      return {
        id: "stub",
        model: "claude-sonnet-4-6",
        content: [
          {
            type: "text",
            text: "```json\n{\"issues\":[{\"category\":\"layout\",\"severity\":\"low\",\"note\":\"ok\"}]}\n```",
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    const res = await runOneVisualIteration({
      render,
      call,
      model: "claude-sonnet-4-6",
      draftHtml: "<p>hi</p>",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      idempotencyKey: "k",
    });
    expect(res.ok).toBe(true);
    expect(order).toEqual(["render", "call"]);
  });

  it("returns RENDER_FAILED when render throws — no critique call made", async () => {
    const render: VisualRenderFn = async () => {
      throw new Error("chromium exploded");
    };
    let callCount = 0;
    const call: AnthropicCallFn = async () => {
      callCount++;
      return {
        id: "never",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    const res = await runOneVisualIteration({
      render,
      call,
      model: "claude-sonnet-4-6",
      draftHtml: "<p>hi</p>",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      idempotencyKey: "k",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("RENDER_FAILED");
    expect(callCount).toBe(0);
  });

  it("surfaces CRITIQUE_PARSE_FAILED from the critique call", async () => {
    const render: VisualRenderFn = async () => RENDER_RESULT;
    const call: AnthropicCallFn = async () => ({
      id: "stub",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "not json" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const res = await runOneVisualIteration({
      render,
      call,
      model: "claude-sonnet-4-6",
      draftHtml: "<p>hi</p>",
      ctx: {
        pageTitle: "Home",
        pageSourceText: "...",
        brandVoice: null,
        designDirection: null,
        siteConventions: null,
        previousCritique: null,
      },
      idempotencyKey: "k",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CRITIQUE_PARSE_FAILED");
  });
});
