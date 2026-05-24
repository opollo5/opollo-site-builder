import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for lib/platform/rate-limit two-layer combiner (index.ts).
//
// Upstash is mocked via @/lib/rate-limit. Postgres is mocked via
// lib/platform/rate-limit/postgres-rate-limit. withHealthMonitoring is
// mocked as a transparent pass-through so combiner logic is unaffected;
// health monitoring behaviour per-layer is tested in dedicated files.
// ---------------------------------------------------------------------------

const { mockWithHealthMonitoring } = vi.hoisted(() => ({
  mockWithHealthMonitoring: vi.fn(<T>(
    _service: string,
    _op: string,
    fn: () => Promise<T>,
  ): Promise<T> => fn()),
}));

vi.mock("@/lib/platform/service-health/monitor", () => ({
  withHealthMonitoring: mockWithHealthMonitoring,
}));

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

function transparentMonitor() {
  mockWithHealthMonitoring.mockImplementation(<T>(
    _service: string,
    _op: string,
    fn: () => Promise<T>,
  ): Promise<T> => fn());
}

beforeEach(() => {
  vi.clearAllMocks();
  transparentMonitor();
});

describe("checkPlatformRateLimit — path 1: Upstash ok → allow (no Postgres)", () => {
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

  it("wraps the Upstash check with withHealthMonitoring('upstash', 'rate-limit')", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      ok: true,
      limit: 120,
      remaining: 119,
      reset: Date.now() + 60_000,
    });

    await checkPlatformRateLimit("chat", "user:abc");

    expect(mockWithHealthMonitoring).toHaveBeenCalledWith(
      "upstash",
      "rate-limit",
      expect.any(Function),
    );
  });
});

describe("checkPlatformRateLimit — path 2: Upstash unavailable → Postgres fallback", () => {
  it("falls back to Postgres when Upstash is unavailable and allows", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("connection refused"));
    mockCheckSlidingWindow.mockResolvedValueOnce({ ok: true });

    const result = await checkPlatformRateLimit("chat", "user:abc");
    expect(result).toEqual({ ok: true });
    expect(mockCheckSlidingWindow).toHaveBeenCalledWith("user:abc", 120, 60);
  });

  it("returns rate-limited from Postgres when Upstash down and Postgres rejects", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("upstash down"));
    mockCheckSlidingWindow.mockResolvedValueOnce({ ok: false, retryAfterSec: 3600 });

    const result = await checkPlatformRateLimit("csv_upload", "company:co-1");
    expect(result).toEqual({ ok: false, retryAfterSec: 3600 });
  });

  it("returns unavailable when Upstash down and no Postgres config for limiter", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("upstash down"));

    const result = await checkPlatformRateLimit("login", "ip:1.2.3.4");
    expect(result).toEqual({ ok: false, unavailable: true });
    expect(mockCheckSlidingWindow).not.toHaveBeenCalled();
  });
});

describe("checkPlatformRateLimit — path 3: both layers fail → 503 (fail-closed)", () => {
  it("returns unavailable when both layers fail", async () => {
    mockCheckRateLimit.mockRejectedValueOnce(new Error("upstash down"));
    mockCheckSlidingWindow.mockResolvedValueOnce({ ok: false, unavailable: true });

    const result = await checkPlatformRateLimit("chat", "user:abc");
    expect(result).toEqual({ ok: false, unavailable: true });
  });

  it("health monitor records Upstash failure when withHealthMonitoring re-throws", async () => {
    // Simulate withHealthMonitoring re-throwing (as it would after recording health event).
    // The outer catch in checkUpstashRateLimit converts re-throw to unavailable,
    // then checkPlatformRateLimit falls back to Postgres.
    mockWithHealthMonitoring.mockImplementationOnce(
      (_service: string, _op: string, _fn: () => unknown) => {
        throw new Error("upstash network timeout");
      },
    );
    mockCheckSlidingWindow.mockResolvedValueOnce({ ok: false, unavailable: true });

    const result = await checkPlatformRateLimit("chat", "user:abc");

    // Upstash health monitor fires, outer catch returns unavailable, Postgres also unavailable.
    expect(result).toEqual({ ok: false, unavailable: true });
    expect(mockWithHealthMonitoring).toHaveBeenCalledWith(
      "upstash",
      "rate-limit",
      expect.any(Function),
    );
  });
});
