import { describe, it, expect, vi, beforeEach } from "vitest";

// Server-only stubs (handled by vitest.unit.config.ts alias, but explicit here for clarity)
vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/platform/brand/get", () => ({
  getActiveBrandProfile: vi.fn().mockResolvedValue(null),
}));

import {
  BadRequestError,
  RateLimitError,
  APIConnectionTimeoutError,
  APIConnectionError,
  InternalServerError,
} from "@anthropic-ai/sdk";

import { generateAssistText } from "@/lib/platform/social/cap/assist";
import type { AnthropicCallFn, AnthropicResponse } from "@/lib/anthropic-call";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  companyId: "company-1",
  prompt: "Write a post about cheese",
  tone: "casual" as const,
  length: "short" as const,
  requestedBy: "user-1",
};

function makeOkResponse(text: string, stop_reason = "end_turn"): AnthropicResponse {
  return {
    id: "msg-1",
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text }],
    stop_reason,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function throwingCallFn(err: unknown): AnthropicCallFn {
  return async () => { throw err; };
}

function resolvingCallFn(resp: AnthropicResponse): AnthropicCallFn {
  return async () => resp;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AI assist error categorizer", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("200 normal completion → ok: true", async () => {
    const result = await generateAssistText(VALID_INPUT, resolvingCallFn(makeOkResponse("Great cheese post!")));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("Great cheese post!");
  });

  it("200 with stop_reason=refusal → content_rejected", async () => {
    const result = await generateAssistText(VALID_INPUT, resolvingCallFn(makeOkResponse("", "refusal")));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("content_rejected");
      expect(result.error.can_retry).toBe(false);
    }
  });

  it("400 BadRequestError → invalid_request (NOT content_rejected)", async () => {
    const err = new BadRequestError(400, {}, "Bad request", new Headers());
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("invalid_request");
      expect(result.error.category).not.toBe("content_rejected");
      expect(result.error.can_retry).toBe(false);
    }
  });

  it("400 with any error.type → invalid_request (Anthropic has no content_policy 400 type)", async () => {
    const err = new BadRequestError(400, { error: { type: "invalid_request_error" } }, "Bad", new Headers());
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.category).toBe("invalid_request");
  });

  it("400 billing/credit error → unknown SERVICE_UNAVAILABLE (not invalid_request)", async () => {
    // Anthropic returns 400 for out-of-credits — err.message is
    // "${status} ${JSON.stringify(errorBody)}", so the check must be on the
    // error body (2nd constructor arg), not the 3rd message string.
    const errorBody = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } };
    const err = new BadRequestError(400, errorBody, "", new Headers());
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("unknown");
      expect(result.error.code).toBe("SERVICE_UNAVAILABLE");
      expect(result.error.can_retry).toBe(false);
      expect(result.error.message).toContain("temporarily unavailable");
    }
  });

  it("429 RateLimitError → rate_limit with retry_after", async () => {
    const headers = new Headers({ "retry-after": "30" });
    const err = new RateLimitError(429, {}, "Rate limit", headers);
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("rate_limit");
      expect(result.error.retry_after).toBe(30);
      expect(result.error.can_retry).toBe(true);
    }
  });

  it("APIConnectionTimeoutError → timeout", async () => {
    const err = new APIConnectionTimeoutError();
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("timeout");
      expect(result.error.can_retry).toBe(true);
    }
  });

  it("APIConnectionError (network) → network", async () => {
    const err = new APIConnectionError({ message: "ECONNREFUSED" });
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("network");
      expect(result.error.can_retry).toBe(true);
    }
  });

  it("500 InternalServerError → unknown", async () => {
    const err = new InternalServerError(500, {}, "Server error", new Headers());
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("unknown");
      expect(result.error.can_retry).toBe(true);
    }
  });

  it("529 overloaded InternalServerError → overloaded", async () => {
    const err = new InternalServerError(529, {}, "Overloaded", new Headers());
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("overloaded");
      expect(result.error.can_retry).toBe(true);
    }
  });

  it("each error result includes a trace_id", async () => {
    const err = new BadRequestError(400, {}, "Bad", new Headers());
    const result = await generateAssistText(VALID_INPUT, throwingCallFn(err));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.trace_id).toMatch(/^ai-gen-/);
  });
});
