import { describe, expect, it } from "vitest";

import {
  CaptionCallError,
  classifyHttpStatus,
  parseCaptionPayload,
} from "@/lib/anthropic-caption";

// ---------------------------------------------------------------------------
// M4-4 — Parser + classifier unit tests.
//
// Fast, in-process. No database required. Structural bounds on the
// caption payload are the mitigation for risk #8 (caption quality
// drift); this file pins them.
// ---------------------------------------------------------------------------

const VALID = {
  caption:
    "A studio photograph of a tabby cat sitting on a windowsill facing soft morning light.",
  alt_text: "Tabby cat on windowsill in soft morning light.",
  tags: ["cat", "animal", "pet", "indoor", "lifestyle"],
};

describe("parseCaptionPayload", () => {
  it("returns the parsed payload for a valid response", () => {
    const payload = parseCaptionPayload(JSON.stringify(VALID));
    expect(payload.caption).toBe(VALID.caption);
    expect(payload.alt_text).toBe(VALID.alt_text);
    expect(payload.tags).toEqual(VALID.tags);
  });

  it("throws CAPTION_PARSE_FAILED for non-JSON text", () => {
    expect(() => parseCaptionPayload("here is a caption: a cat!")).toThrow(
      CaptionCallError,
    );
    try {
      parseCaptionPayload("nope");
    } catch (err) {
      expect(err).toBeInstanceOf(CaptionCallError);
      expect((err as CaptionCallError).code).toBe("CAPTION_PARSE_FAILED");
      expect((err as CaptionCallError).retryable).toBe(false);
    }
  });

  it("throws CAPTION_VALIDATION_FAILED for short caption", () => {
    const bad = JSON.stringify({ ...VALID, caption: "too short" });
    try {
      parseCaptionPayload(bad);
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as CaptionCallError).code).toBe("CAPTION_VALIDATION_FAILED");
      expect((err as CaptionCallError).retryable).toBe(false);
    }
  });

  it("throws CAPTION_VALIDATION_FAILED for tags count below 3", () => {
    const bad = JSON.stringify({ ...VALID, tags: ["one", "two"] });
    expect(() => parseCaptionPayload(bad)).toThrow(/VALIDATION/);
  });

  it("throws CAPTION_VALIDATION_FAILED for tags count above 10", () => {
    const bad = JSON.stringify({
      ...VALID,
      tags: Array.from({ length: 11 }, (_, i) => `t${i}`),
    });
    expect(() => parseCaptionPayload(bad)).toThrow(/VALIDATION/);
  });

  it("throws CAPTION_VALIDATION_FAILED for missing alt_text", () => {
    const bad = JSON.stringify({ caption: VALID.caption, tags: VALID.tags });
    expect(() => parseCaptionPayload(bad)).toThrow(/VALIDATION/);
  });
});

describe("classifyHttpStatus", () => {
  it("null status is retryable network error", () => {
    const c = classifyHttpStatus(null);
    expect(c.code).toBe("ANTHROPIC_NETWORK_ERROR");
    expect(c.retryable).toBe(true);
  });

  it("429 is retryable rate-limited", () => {
    const c = classifyHttpStatus(429);
    expect(c.code).toBe("ANTHROPIC_RATE_LIMITED");
    expect(c.retryable).toBe(true);
  });

  it("500 is retryable server error", () => {
    const c = classifyHttpStatus(500);
    expect(c.code).toBe("ANTHROPIC_SERVER_ERROR");
    expect(c.retryable).toBe(true);
  });

  it("400 is non-retryable client error", () => {
    const c = classifyHttpStatus(400);
    expect(c.code).toBe("ANTHROPIC_CLIENT_ERROR");
    expect(c.retryable).toBe(false);
  });

  it("401 is non-retryable client error", () => {
    const c = classifyHttpStatus(401);
    expect(c.code).toBe("ANTHROPIC_CLIENT_ERROR");
    expect(c.retryable).toBe(false);
  });
});
