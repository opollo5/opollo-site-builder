import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { computeRetryUpdate, BACKOFF_SECONDS } from "@/lib/platform/social/publishing/auto-retry";

// ---------------------------------------------------------------------------
// auto-retry.unit.test.ts
//
// Pure unit tests for computeRetryUpdate — no Supabase required.
// ---------------------------------------------------------------------------

describe("computeRetryUpdate — retryable error classes", () => {
  const RETRYABLE = ["rate_limit", "network", "platform_error", "unknown", "worker_died"];

  it.each(RETRYABLE)("schedules next_retry_at for '%s' on first failure", (errorClass) => {
    const result = computeRetryUpdate(0, 5, errorClass);
    expect(result.dead_lettered_at).toBeNull();
    expect(result.next_retry_at).not.toBeNull();
  });

  it("uses backoff[0]=0s delay when retry_count=0", () => {
    const before = Date.now();
    const result = computeRetryUpdate(0, 5, "network");
    const after = Date.now();

    expect(result.next_retry_at).not.toBeNull();
    const scheduled = Date.parse(result.next_retry_at!);
    // backoff[0] = 0s → scheduled ≈ now
    expect(scheduled).toBeGreaterThanOrEqual(before);
    expect(scheduled).toBeLessThanOrEqual(after + 100);
  });

  it("uses backoff[1]=30s delay when retry_count=1", () => {
    const before = Date.now();
    const result = computeRetryUpdate(1, 5, "rate_limit");
    const after = Date.now();

    expect(result.next_retry_at).not.toBeNull();
    const scheduled = Date.parse(result.next_retry_at!);
    const expectedLow = before + BACKOFF_SECONDS[1] * 1000;
    const expectedHigh = after + BACKOFF_SECONDS[1] * 1000 + 100;
    expect(scheduled).toBeGreaterThanOrEqual(expectedLow);
    expect(scheduled).toBeLessThanOrEqual(expectedHigh);
  });

  it("uses backoff[2]=5min delay when retry_count=2", () => {
    const before = Date.now();
    const result = computeRetryUpdate(2, 5, "platform_error");
    const scheduled = Date.parse(result.next_retry_at!);
    expect(scheduled).toBeGreaterThanOrEqual(before + BACKOFF_SECONDS[2] * 1000);
  });
});

describe("computeRetryUpdate — dead-letter conditions", () => {
  it("dead-letters content_rejected immediately regardless of retry_count", () => {
    const result = computeRetryUpdate(0, 5, "content_rejected");
    expect(result.dead_lettered_at).not.toBeNull();
    expect(result.next_retry_at).toBeNull();
  });

  it("dead-letters auth errors immediately", () => {
    const result = computeRetryUpdate(0, 5, "auth");
    expect(result.dead_lettered_at).not.toBeNull();
    expect(result.next_retry_at).toBeNull();
  });

  it("dead-letters media_invalid immediately", () => {
    const result = computeRetryUpdate(0, 5, "media_invalid");
    expect(result.dead_lettered_at).not.toBeNull();
    expect(result.next_retry_at).toBeNull();
  });

  it("dead-letters when retry_count equals max_retries", () => {
    const result = computeRetryUpdate(5, 5, "network");
    expect(result.dead_lettered_at).not.toBeNull();
    expect(result.next_retry_at).toBeNull();
  });

  it("dead-letters when retry_count exceeds max_retries", () => {
    const result = computeRetryUpdate(6, 5, "platform_error");
    expect(result.dead_lettered_at).not.toBeNull();
    expect(result.next_retry_at).toBeNull();
  });

  it("dead-letters retryable error when max_retries=0", () => {
    const result = computeRetryUpdate(0, 0, "network");
    expect(result.dead_lettered_at).not.toBeNull();
    expect(result.next_retry_at).toBeNull();
  });
});

describe("computeRetryUpdate — max_retries=1 fast-fail", () => {
  it("schedules retry for retry_count=0", () => {
    const result = computeRetryUpdate(0, 1, "network");
    expect(result.next_retry_at).not.toBeNull();
    expect(result.dead_lettered_at).toBeNull();
  });

  it("dead-letters for retry_count=1 (hit ceiling)", () => {
    const result = computeRetryUpdate(1, 1, "network");
    expect(result.dead_lettered_at).not.toBeNull();
    expect(result.next_retry_at).toBeNull();
  });
});
