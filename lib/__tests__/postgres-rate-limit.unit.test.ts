import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for lib/platform/rate-limit/postgres-rate-limit.ts
//
// Verifies that withHealthMonitoring is called correctly and that the
// fail-closed behaviour (unavailable:true on DB error) is enforced.
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

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

import {
  checkSlidingWindowRateLimit,
  checkBulkCsvRateLimit,
} from "@/lib/platform/rate-limit/postgres-rate-limit";

function makeWindowChain(
  countResult: { count: number | null; error: null | { message: string } },
) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue(countResult),
    insert: vi.fn().mockResolvedValue({ error: null }),
  };
}

function makeCsvChain(
  countResult: { count: number | null; error: null | { message: string } },
) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue(countResult),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWithHealthMonitoring.mockImplementation(<T>(
    _service: string,
    _op: string,
    fn: () => Promise<T>,
  ): Promise<T> => fn());
});

describe("checkSlidingWindowRateLimit — happy path", () => {
  it("allows when count is below limit and records the request", async () => {
    mockFrom.mockReturnValue(makeWindowChain({ count: 5, error: null }));

    const result = await checkSlidingWindowRateLimit("user:abc", 10, 60);

    expect(result).toEqual({ ok: true });
  });

  it("denies when count meets or exceeds limit", async () => {
    mockFrom.mockReturnValue(makeWindowChain({ count: 10, error: null }));

    const result = await checkSlidingWindowRateLimit("user:abc", 10, 60);

    expect(result).toEqual({ ok: false, retryAfterSec: 60 });
  });

  it("wraps the DB query with withHealthMonitoring('postgres', 'rate-limit')", async () => {
    mockFrom.mockReturnValue(makeWindowChain({ count: 0, error: null }));

    await checkSlidingWindowRateLimit("user:abc", 10, 60);

    expect(mockWithHealthMonitoring).toHaveBeenCalledWith(
      "postgres",
      "rate-limit",
      expect.any(Function),
    );
  });
});

describe("checkSlidingWindowRateLimit — fail-closed on DB error", () => {
  it("returns unavailable when PostgREST returns an error (health event fires, re-throws)", async () => {
    // The error is thrown inside withHealthMonitoring, which records the health event
    // and re-throws. The outer catch in checkSlidingWindowRateLimit returns unavailable.
    mockFrom.mockReturnValue(makeWindowChain({ count: null, error: { message: "DB error" } }));

    const result = await checkSlidingWindowRateLimit("user:abc", 10, 60);

    expect(result).toEqual({ ok: false, unavailable: true });
  });

  it("returns unavailable when withHealthMonitoring itself re-throws (DB outage)", async () => {
    mockWithHealthMonitoring.mockImplementationOnce(
      (_service: string, _op: string, _fn: () => unknown) => {
        throw new Error("connection refused");
      },
    );

    const result = await checkSlidingWindowRateLimit("user:abc", 10, 60);

    expect(result).toEqual({ ok: false, unavailable: true });
    expect(mockWithHealthMonitoring).toHaveBeenCalledWith(
      "postgres",
      "rate-limit",
      expect.any(Function),
    );
  });
});

describe("checkBulkCsvRateLimit — happy path", () => {
  it("allows when upload count is below 3 per hour", async () => {
    mockFrom.mockReturnValue(makeCsvChain({ count: 2, error: null }));

    const result = await checkBulkCsvRateLimit("company:123");

    expect(result).toEqual({ ok: true });
  });

  it("denies when upload count meets 3", async () => {
    mockFrom.mockReturnValue(makeCsvChain({ count: 3, error: null }));

    const result = await checkBulkCsvRateLimit("company:123");

    expect(result).toEqual({ ok: false, retryAfterSec: 3600 });
  });

  it("wraps with withHealthMonitoring('postgres', 'rate-limit')", async () => {
    mockFrom.mockReturnValue(makeCsvChain({ count: 0, error: null }));

    await checkBulkCsvRateLimit("company:123");

    expect(mockWithHealthMonitoring).toHaveBeenCalledWith(
      "postgres",
      "rate-limit",
      expect.any(Function),
    );
  });
});

describe("checkBulkCsvRateLimit — fail-closed on DB error", () => {
  it("returns unavailable when PostgREST returns an error", async () => {
    mockFrom.mockReturnValue(makeCsvChain({ count: null, error: { message: "connection refused" } }));

    const result = await checkBulkCsvRateLimit("company:123");

    expect(result).toEqual({ ok: false, unavailable: true });
  });
});
