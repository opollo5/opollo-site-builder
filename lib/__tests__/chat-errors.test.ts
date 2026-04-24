import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

import {
  SAFE_CHAT_ERROR_CODE,
  SAFE_CHAT_ERROR_MESSAGE,
  buildChatErrorDiagnostic,
  buildSafeSseErrorPayload,
} from "@/lib/chat-errors";

// ---------------------------------------------------------------------------
// M15-4 — chat SSE error sanitization.
//
// Pins two invariants:
//   1. The SSE payload the browser receives is a constant shape regardless
//      of the underlying error. No raw error message, no Anthropic API
//      body, no stack trace, no internal file paths.
//   2. The server-side diagnostic retains the full error context so
//      operators can debug from Axiom / Vercel logs.
//
// Every "forbidden substring" below is something the pre-M15-4 code would
// have sent to the browser unchanged. The leak regression test asserts
// none of them appear in the serialized SSE payload.
// ---------------------------------------------------------------------------

describe("buildSafeSseErrorPayload", () => {
  it("returns the constant safe shape with the passed request_id", () => {
    const payload = buildSafeSseErrorPayload("req-abc-123");
    expect(payload).toEqual({
      code: "INTERNAL_ERROR",
      message: SAFE_CHAT_ERROR_MESSAGE,
      request_id: "req-abc-123",
    });
  });

  it("accepts a null request_id for contexts where the id is unavailable", () => {
    const payload = buildSafeSseErrorPayload(null);
    expect(payload.request_id).toBeNull();
    expect(payload.code).toBe(SAFE_CHAT_ERROR_CODE);
    expect(payload.message).toBe(SAFE_CHAT_ERROR_MESSAGE);
  });

  it("emits the same static message across different request_ids", () => {
    const a = buildSafeSseErrorPayload("req-1");
    const b = buildSafeSseErrorPayload("req-2");
    expect(a.message).toBe(b.message);
    expect(a.code).toBe(b.code);
  });
});

describe("buildChatErrorDiagnostic — server-side log contract", () => {
  it("captures the full error context for an Anthropic APIError", () => {
    const apiErr = new Anthropic.APIError(
      429,
      { error: { type: "rate_limit_exceeded", message: "quota exceeded" } },
      "Rate limit exceeded",
      new Headers({ "x-anthropic-request-id": "anth-req-xyz" }),
    );
    const diagnostic = buildChatErrorDiagnostic(
      apiErr,
      "claude-opus-4-7",
      apiErr,
    );
    // The Anthropic SDK composes APIError.message from status + body, so
    // we assert on substrings rather than equality. The invariant we
    // care about is "the full error context reaches the server log" —
    // not the exact serialization.
    expect(diagnostic.message).toContain("429");
    expect(diagnostic.message).toContain("rate_limit_exceeded");
    expect(diagnostic.status).toBe(429);
    expect(diagnostic.body).toEqual({
      error: { type: "rate_limit_exceeded", message: "quota exceeded" },
    });
    expect(diagnostic.stack).toBeTypeOf("string");
    expect(diagnostic.model).toBe("claude-opus-4-7");
  });

  it("captures a plain Error without an Anthropic wrapper", () => {
    const err = new Error("database connection lost");
    const diagnostic = buildChatErrorDiagnostic(err, "test-model", null);
    expect(diagnostic.message).toBe("database connection lost");
    expect(diagnostic.name).toBe("Error");
    expect(diagnostic.status).toBeUndefined();
    expect(diagnostic.body).toBeUndefined();
    expect(diagnostic.stack).toBeTypeOf("string");
    expect(diagnostic.model).toBe("test-model");
  });

  it("stringifies non-Error throws", () => {
    const diagnostic = buildChatErrorDiagnostic("string thrown", "m", null);
    expect(diagnostic.message).toBe("string thrown");
    expect(diagnostic.stack).toBeUndefined();
    expect(diagnostic.name).toBeUndefined();
  });
});

describe("chat SSE error leak regression", () => {
  // Each case pairs a realistic failure with the substrings that would
  // have been exposed under the pre-M15-4 payload shape. The safe payload
  // is built from only the request_id, so by construction none of the
  // error content can appear — but the test guards against a future
  // refactor that adds `err` back to the function signature.
  const cases: Array<{ name: string; err: unknown; forbidden: string[] }> = [
    {
      name: "Anthropic rate-limit with internal quota detail",
      err: new Anthropic.APIError(
        429,
        {
          error: {
            type: "rate_limit_exceeded",
            message: "org_abc123 has exceeded its daily quota",
          },
        },
        "429 Too Many Requests",
        new Headers({ "x-anthropic-request-id": "anth-req-xyz" }),
      ),
      forbidden: [
        "org_abc123",
        "rate_limit_exceeded",
        "exceeded its daily quota",
        "429 Too Many Requests",
      ],
    },
    {
      name: "Supabase schema error revealing table + column names",
      err: Object.assign(
        new Error(
          'column "deleted_at" of relation "opollo_users" does not exist',
        ),
        { code: "42703", details: null, hint: null },
      ),
      forbidden: [
        "deleted_at",
        "opollo_users",
        "42703",
        "does not exist",
        "relation",
      ],
    },
    {
      name: "TypeError exposing internal file paths",
      err: new TypeError(
        "Cannot read property 'wp_secret' of undefined at /var/task/.next/server/lib/sites.js:234",
      ),
      forbidden: [
        "wp_secret",
        "/var/task",
        ".next/server",
        "sites.js:234",
      ],
    },
  ];

  for (const { name, err: _err, forbidden } of cases) {
    it(`does not leak: ${name}`, () => {
      const payload = buildSafeSseErrorPayload("req-leak-test");
      const serialized = JSON.stringify(payload);
      for (const substring of forbidden) {
        expect(serialized).not.toContain(substring);
      }
    });
  }

  it("the safe payload type rejects an error argument at compile time", () => {
    // This test documents the type-level invariant. The function signature
    // is (requestId: string | null) => SafeChatSseErrorPayload. Passing an
    // Error would be a TypeScript error. Runtime version of the check:
    // calling with only a requestId produces a payload with no error
    // field.
    const payload = buildSafeSseErrorPayload("req-abc");
    expect(Object.keys(payload).sort()).toEqual(
      ["code", "message", "request_id"].sort(),
    );
    // No "error", "err", "details", "body", "stack", "name" keys.
    const forbiddenKeys = [
      "error",
      "err",
      "details",
      "body",
      "stack",
      "name",
      "status",
    ];
    for (const key of forbiddenKeys) {
      expect(payload).not.toHaveProperty(key);
    }
  });
});
