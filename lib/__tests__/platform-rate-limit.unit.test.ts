import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for lib/platform/rate-limit two-layer combiner.
//
// Upstash is mocked via @/lib/rate-limit. Postgres is mocked via
// lib/platform/rate-limit/postgres-rate-limit.
// ---------------------------------------------------------------------------

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/platform/rate-limit/postgres-rate-limit", () => ({
  checkSlidingWindowRateLimit: vi.fn(),
  checkBulkCsvRateLimit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { checkRateLimit } from "@/lib/rate-limit";
import { checkSlidingWindowRateLimit } from "@/lib/platform/rate-limit/postgres-rate-limit";
import { checkPlatformRateLimit } from "@/lib/platform/rate-limit";

const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockCheckSlidingWindow = vi.mocked(checkSlidingWindowRateLimit);

describe("checkPlatformRateLimit — two-layer combiner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok:true when Upstash allows", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      ok: true,
      limit: 120,
      remaining: 119,
      reset: Date.now() + 60_000,
    });

    const result = await checkPlatformRateLimit("chat", "user:abc");
    expect(result).toEqual({ ok: true });
    expect(mockCheckSlidingWindow).not.toHaveBeenCalled();
  });

  it("returns ok:false when Upstash rate-limits (no Postgres call)", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      ok: false,
      limit: 120,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfterSec: 60,
    });

    const result = await checkPlatformRateLimit("chat", "user:abc");
    expect(result).toEqual({ ok: false, retryAfterSec: 60 });
    expect(mockCheckSlidingWindow).not.toHaveBeenCalled();
  });

  it("falls back to Postgres when Upstash is unavailable and allows", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("connection refused"));
    mockCheckSlidingWindow.mockResolvedValueOnce({ ok: true });

    const result = await checkPlatformRateLimit("chat", "user:abc");
    expect(result).toEqual({ ok: true });
    expect(mockCheckSlidingWindow).toHaveBeenCalledWith("user:abc", 120, 60);
  });

  it("returns unavailable when both layers fail (fail-closed)", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("upstash down"));
    mockCheckSlidingWindow.mockResolvedValueOnce({ ok: false, unavailable: true });

    const result = await checkPlatformRateLimit("chat", "user:abc");
    expect(result).toEqual({ ok: false, unavailable: true });
  });

  it("returns unavailable when Upstash is down and no Postgres config for limiter", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("upstash down"));

    // "login" has no Postgres config entry
    const result = await checkPlatformRateLimit("login", "ip:1.2.3.4");
    expect(result).toEqual({ ok: false, unavailable: true });
    expect(mockCheckSlidingWindow).not.toHaveBeenCalled();
  });

  it("returns rate-limited from Postgres when Upstash down and Postgres rejects", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("upstash down"));
    mockCheckSlidingWindow.mockResolvedValueOnce({ ok: false, retryAfterSec: 3600 });

    const result = await checkPlatformRateLimit("csv_upload", "company:co-1");
    expect(result).toEqual({ ok: false, retryAfterSec: 3600 });
  });
});
