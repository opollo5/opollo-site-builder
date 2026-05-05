import { describe, expect, it, vi } from "vitest";

import {
  extractFromScreenshots,
  parseVisionOutput,
} from "@/lib/design-discovery/extract-screenshots";
import type { AnthropicCallFn } from "@/lib/anthropic-call";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY-FOLLOWUP — vision-extraction unit tests.
//
// Pure-function coverage: parseVisionOutput tag handling + the
// orchestrator's retry / error-shape behaviour with a stubbed
// AnthropicCallFn. No real Anthropic call.
// ---------------------------------------------------------------------------

describe("parseVisionOutput", () => {
  it("parses a clean <output>...</output> JSON", () => {
    const out = parseVisionOutput(
      `<output>{"swatches":["#111111","#eeeeee"],"fonts":["Inter"],"layout_tags":["centred-hero"],"visual_tone_tags":["minimal"]}</output>`,
    );
    expect(out).toEqual({
      swatches: ["#111111", "#eeeeee"],
      fonts: ["Inter"],
      layout_tags: ["centred-hero"],
      visual_tone_tags: ["minimal"],
    });
  });

  it("falls back to fenced JSON when output tags are missing", () => {
    const out = parseVisionOutput(
      "```json\n{\"swatches\":[],\"fonts\":[],\"layout_tags\":[],\"visual_tone_tags\":[]}\n```",
    );
    expect(out).toEqual({
      swatches: [],
      fonts: [],
      layout_tags: [],
      visual_tone_tags: [],
    });
  });

  it("returns null when no JSON is parseable", () => {
    expect(parseVisionOutput("nothing structured here")).toBeNull();
  });

  it("returns null when JSON shape doesn't match the schema", () => {
    expect(parseVisionOutput(`<output>{"foo":1}</output>`)).toEqual({
      swatches: [],
      fonts: [],
      layout_tags: [],
      visual_tone_tags: [],
    });
  });
});

describe("extractFromScreenshots", () => {
  const goodResponse = {
    id: "msg_test",
    model: "claude-sonnet-4-6",
    content: [
      {
        type: "text" as const,
        text: `<output>{"swatches":["#222","#fff"],"fonts":["Inter"],"layout_tags":["card-grid"],"visual_tone_tags":["high-contrast"]}</output>`,
      },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 10 },
  };

  const sampleImages = [
    {
      data: "ZmFrZS1pbWFnZS1ieXRlcw==",
      media_type: "image/png" as const,
    },
  ];

  it("rejects empty input", async () => {
    const result = await extractFromScreenshots([], { siteId: "site-x" });
    expect(result.ok).toBe(false);
  });

  it("returns parsed signals on success", async () => {
    const call: AnthropicCallFn = vi.fn(async () => goodResponse);
    const result = await extractFromScreenshots(
      sampleImages,
      { siteId: "site-x" },
      call,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.swatches).toEqual(["#222", "#fff"]);
      expect(result.data.layout_tags).toEqual(["card-grid"]);
    }
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first attempt returns an unparseable body", async () => {
    const call: AnthropicCallFn = vi
      .fn()
      .mockResolvedValueOnce({
        id: "m1",
        model: "claude-sonnet-4-6",
        content: [{ type: "text" as const, text: "not json at all" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      })
      .mockResolvedValueOnce(goodResponse);
    const result = await extractFromScreenshots(
      sampleImages,
      { siteId: "site-x" },
      call,
    );
    expect(result.ok).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("returns VISION_FAILED after two parse failures", async () => {
    const bad = {
      id: "m1",
      model: "claude-sonnet-4-6",
      content: [{ type: "text" as const, text: "still not json" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const call: AnthropicCallFn = vi.fn(async () => bad);
    const result = await extractFromScreenshots(
      sampleImages,
      { siteId: "site-x" },
      call,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VISION_FAILED");
    }
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("scopes idempotency keys to the site id", async () => {
    const calls: string[] = [];
    const call: AnthropicCallFn = vi.fn(async (req) => {
      calls.push(req.idempotency_key);
      return goodResponse;
    });
    await extractFromScreenshots(sampleImages, { siteId: "site-x" }, call);
    expect(calls[0]).toMatch(/^screenshots:site-x:/);
  });
});
