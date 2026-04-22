import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetLangfuseClientForTests,
  traceAnthropicCall,
  traceAnthropicStream,
} from "@/lib/langfuse";

// ---------------------------------------------------------------------------
// Langfuse wrapper contract tests.
//
// The whole point of the wrapper is that production + test builds
// should behave identically when Langfuse env vars are missing: pure
// no-op, no throws, no network. These tests pin that contract.
//
// We don't exercise the configured-env path here — that would need a
// live Langfuse project (or a mock SDK), and the wrapper's surface area
// is small enough that the no-op shape is the load-bearing test.
// ---------------------------------------------------------------------------

describe("lib/langfuse — no-op when env unset", () => {
  const originalPublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const originalSecretKey = process.env.LANGFUSE_SECRET_KEY;

  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    __resetLangfuseClientForTests();
  });

  afterEach(() => {
    if (originalPublicKey === undefined) {
      delete process.env.LANGFUSE_PUBLIC_KEY;
    } else {
      process.env.LANGFUSE_PUBLIC_KEY = originalPublicKey;
    }
    if (originalSecretKey === undefined) {
      delete process.env.LANGFUSE_SECRET_KEY;
    } else {
      process.env.LANGFUSE_SECRET_KEY = originalSecretKey;
    }
    __resetLangfuseClientForTests();
  });

  it("traceAnthropicCall returns a no-op handle with traceId=null", () => {
    const handle = traceAnthropicCall({ name: "unit_test" });
    expect(handle.traceId).toBeNull();
    expect(() =>
      handle.end({
        response_id: "r_1",
        model: "claude-x",
        input_tokens: 10,
        output_tokens: 5,
        cost_cents: 0,
      }),
    ).not.toThrow();
    expect(() => handle.fail("boom")).not.toThrow();
  });

  it("traceAnthropicStream returns a no-op handle with traceId=null", () => {
    const handle = traceAnthropicStream({
      name: "chat_stream_unit_test",
      metadata: { iter: 0 },
    });
    expect(handle.traceId).toBeNull();
    expect(() =>
      handle.recordFinal({
        id: "msg_1",
        model: "claude-opus-4-7",
        stop_reason: "end_turn",
        usage: {
          input_tokens: 100,
          output_tokens: 42,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    ).not.toThrow();
    expect(() => handle.fail("upstream_failed")).not.toThrow();
  });

  it("traceAnthropicStream double-close is safe (recordFinal then fail)", () => {
    const handle = traceAnthropicStream({ name: "double_close_test" });
    handle.recordFinal({
      id: "msg_2",
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    // A subsequent fail() should not throw even though the span is closed.
    expect(() => handle.fail("race_after_close")).not.toThrow();
  });
});
