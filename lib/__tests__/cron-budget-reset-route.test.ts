import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Route handler tests for GET|POST /api/cron/budget-reset (M15-6 #5-12).
//
// Covers auth guard, successful reset delegation, and error handling.
// ---------------------------------------------------------------------------

const mockConstantTimeEqual = vi.hoisted(() => vi.fn());
const mockResetExpiredBudgets = vi.hoisted(() => vi.fn());

vi.mock("@/lib/crypto-compare", () => ({
  constantTimeEqual: mockConstantTimeEqual,
}));

vi.mock("@/lib/tenant-budgets", () => ({
  resetExpiredBudgets: mockResetExpiredBudgets,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { GET, POST } from "@/app/api/cron/budget-reset/route";

function makeRequest(
  method: "GET" | "POST" = "GET",
  authHeader?: string,
): Request {
  return new Request("http://localhost/api/cron/budget-reset", {
    method,
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

const VALID_RESET_RESULT = {
  daily_reset_count: 2,
  monthly_reset_count: 0,
};

beforeEach(() => {
  process.env.CRON_SECRET = "a".repeat(32);
  mockConstantTimeEqual.mockReset().mockReturnValue(false);
  mockResetExpiredBudgets.mockReset().mockResolvedValue(VALID_RESET_RESULT);
});

describe("GET /api/cron/budget-reset — auth", () => {
  it("401 when no authorization header", async () => {
    const res = await GET(makeRequest("GET") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 when authorization header doesn't match", async () => {
    mockConstantTimeEqual.mockReturnValue(false);

    const res = await GET(makeRequest("GET", "Bearer wrong-secret") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(401);
  });

  it("401 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;

    const res = await GET(makeRequest("GET", "Bearer some-secret") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/budget-reset — success", () => {
  it("200 — delegates to resetExpiredBudgets and returns result", async () => {
    mockConstantTimeEqual.mockReturnValue(true);

    const res = await GET(makeRequest("GET", "Bearer valid-secret") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(VALID_RESET_RESULT);
    expect(typeof body.timestamp).toBe("string");
    expect(mockResetExpiredBudgets).toHaveBeenCalledOnce();
  });
});

describe("POST /api/cron/budget-reset", () => {
  it("200 — POST also delegates through handle()", async () => {
    mockConstantTimeEqual.mockReturnValue(true);

    const res = await POST(makeRequest("POST", "Bearer valid-secret") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockResetExpiredBudgets).toHaveBeenCalledOnce();
  });

  it("401 — POST also checks auth", async () => {
    mockConstantTimeEqual.mockReturnValue(false);

    const res = await POST(makeRequest("POST", "Bearer wrong") as Parameters<typeof POST>[0]);

    expect(res.status).toBe(401);
  });
});

describe("GET /api/cron/budget-reset — error handling", () => {
  it("500 — resetExpiredBudgets throws → structured error response", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    mockResetExpiredBudgets.mockRejectedValue(new Error("DB connection lost"));

    const res = await GET(makeRequest("GET", "Bearer valid-secret") as Parameters<typeof GET>[0]);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toContain("DB connection lost");
    expect(body.error.retryable).toBe(true);
  });
});
