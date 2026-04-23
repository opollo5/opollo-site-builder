import { describe, it, expect } from "vitest";
import { computeCostCents } from "../anthropic-pricing";

describe("anthropic-pricing", () => {
  it("should compute 1M Opus input tokens as 1500 cents ($15)", () => {
    const result = computeCostCents("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });

    expect(result.rateFound).toBe(true);
    // $15 per 1M tokens = 1500 cents
    expect(result.cents).toBe(1500);
  });

  it("should compute 1M Sonnet input tokens as 300 cents ($3)", () => {
    const result = computeCostCents("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });

    expect(result.rateFound).toBe(true);
    // $3 per 1M tokens = 300 cents
    expect(result.cents).toBe(300);
  });

  it("should compute 1M Haiku input tokens as 80 cents ($0.80)", () => {
    const result = computeCostCents("claude-haiku-4-5-20251001", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });

    expect(result.rateFound).toBe(true);
    // $0.80 per 1M tokens = 80 cents
    expect(result.cents).toBe(80);
  });

  it("should compute mixed usage correctly", () => {
    // Opus: $15 input + $75 output per 1M tokens
    const result = computeCostCents("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });

    expect(result.rateFound).toBe(true);
    // 1M input @ $15/M = 1500 cents
    // 1M output @ $75/M = 7500 cents
    // Total = 9000 cents = $90
    expect(result.cents).toBe(9000);
  });

  it("should handle cache writes and reads", () => {
    // Opus cache: $18.75 write, $1.50 read per 1M tokens
    const result = computeCostCents("claude-opus-4-7", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });

    expect(result.rateFound).toBe(true);
    // 1M cache write @ $18.75/M = 1875 cents
    // 1M cache read @ $1.50/M = 150 cents
    // Total = 2025 cents = $20.25
    expect(result.cents).toBe(2025);
  });

  it("should return false and 0 for unknown models", () => {
    const result = computeCostCents("claude-unknown", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });

    expect(result.rateFound).toBe(false);
    expect(result.cents).toBe(0);
  });
});
