import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for GET|POST /api/cron/process-batch (M15-6 #5).
//
// Covers: auth guard (no header, wrong secret, unset secret), no-work tick,
// slot-processed tick, ANTHROPIC_API_KEY routing, and 500 error handling.
// All batch-worker calls are mocked — worker internals are well-covered by
// their own suite; this suite pins the HTTP entry point.
// ---------------------------------------------------------------------------

const mockConstantTimeEqual = vi.hoisted(() => vi.fn());
const mockReapExpiredLeases = vi.hoisted(() => vi.fn());
const mockLeaseNextPage = vi.hoisted(() => vi.fn());
const mockProcessSlotAnthropic = vi.hoisted(() => vi.fn());
const mockProcessSlotDummy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/crypto-compare", () => ({
  constantTimeEqual: mockConstantTimeEqual,
}));

vi.mock("@/lib/batch-worker", () => ({
  DEFAULT_LEASE_MS: 300_000,
  reapExpiredLeases: mockReapExpiredLeases,
  leaseNextPage: mockLeaseNextPage,
  processSlotAnthropic: mockProcessSlotAnthropic,
  processSlotDummy: mockProcessSlotDummy,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from "@/app/api/cron/process-batch/route";

function makeRequest(method: "GET" | "POST" = "GET", authHeader?: string): Request {
  return new Request("http://localhost/api/cron/process-batch", {
    method,
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "a".repeat(32);
  delete process.env.ANTHROPIC_API_KEY;
  mockConstantTimeEqual.mockReset().mockReturnValue(false);
  mockReapExpiredLeases.mockReset().mockResolvedValue({ reapedCount: 0 });
  mockLeaseNextPage.mockReset().mockResolvedValue(null);
  mockProcessSlotAnthropic.mockReset().mockResolvedValue(undefined);
  mockProcessSlotDummy.mockReset().mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-batch — auth", () => {
  it("401 when no authorization header", async () => {
    const res = await GET(makeRequest("GET") as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 when header doesn't match", async () => {
    mockConstantTimeEqual.mockReturnValue(false);
    const res = await GET(makeRequest("GET", "Bearer wrong-secret") as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it("401 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest("GET", "Bearer any-secret") as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// No-work tick (no slot available)
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-batch — no-work tick", () => {
  it("200 — returns reapedCount and null processedSlotId when no slot", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockReapExpiredLeases.mockResolvedValue({ reapedCount: 3 });
    mockLeaseNextPage.mockResolvedValue(null);

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.reapedCount).toBe(3);
    expect(body.data.processedSlotId).toBeNull();
    expect(typeof body.timestamp).toBe("string");
    expect(mockProcessSlotDummy).not.toHaveBeenCalled();
    expect(mockProcessSlotAnthropic).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Slot-processed tick — dummy path (no ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-batch — dummy processor path", () => {
  it("200 — calls processSlotDummy when ANTHROPIC_API_KEY unset", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockLeaseNextPage.mockResolvedValue({ id: "slot-abc" });

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.processedSlotId).toBe("slot-abc");
    expect(mockProcessSlotDummy).toHaveBeenCalledWith("slot-abc", expect.any(String));
    expect(mockProcessSlotAnthropic).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Slot-processed tick — Anthropic path (ANTHROPIC_API_KEY set)
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-batch — Anthropic processor path", () => {
  it("200 — calls processSlotAnthropic when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockConstantTimeEqual.mockReturnValue(true);
    mockLeaseNextPage.mockResolvedValue({ id: "slot-xyz" });

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.processedSlotId).toBe("slot-xyz");
    expect(mockProcessSlotAnthropic).toHaveBeenCalledWith("slot-xyz", expect.any(String));
    expect(mockProcessSlotDummy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST symmetry
// ---------------------------------------------------------------------------

describe("POST /api/cron/process-batch", () => {
  it("200 — POST goes through the same handle()", async () => {
    mockConstantTimeEqual.mockReturnValue(true);

    const res = await POST(makeRequest("POST", "Bearer valid") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("401 — POST also checks auth", async () => {
    mockConstantTimeEqual.mockReturnValue(false);

    const res = await POST(makeRequest("POST", "Bearer bad") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("GET /api/cron/process-batch — error handling", () => {
  it("500 — runTick throws → structured INTERNAL_ERROR response", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockReapExpiredLeases.mockRejectedValue(new Error("DB connection lost"));

    const res = await GET(makeRequest("GET", "Bearer valid") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toContain("DB connection lost");
    expect(body.error.retryable).toBe(true);
  });
});
