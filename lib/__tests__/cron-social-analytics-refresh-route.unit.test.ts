import { beforeEach, describe, expect, it, vi } from "vitest";

// LAYER 1 — Unit. Route auth + delegation tests for the daily
// /api/cron/social-analytics-refresh endpoint.

const mockConstantTimeEqual = vi.hoisted(() => vi.fn());
const mockRefreshAll = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
const mockRecordHealthEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@/lib/crypto-compare", () => ({
  constantTimeEqual: mockConstantTimeEqual,
}));

vi.mock("@/lib/platform/social/analytics-ingest", () => ({
  refreshAnalyticsForAllProfiles: mockRefreshAll,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: () => ({ insert: mockInsert }),
  }),
}));

vi.mock("@/lib/platform/service-health/record", () => ({
  recordHealthEvent: mockRecordHealthEvent,
}));

import { GET, POST } from "@/app/api/cron/social-analytics-refresh/route";

function req(method: "GET" | "POST", authHeader?: string): Request {
  return new Request("http://localhost/api/cron/social-analytics-refresh", {
    method,
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "a".repeat(32);
  process.env.BUNDLE_SOCIAL_API = "test-api-key";
  mockConstantTimeEqual.mockReset().mockReturnValue(false);
  mockRefreshAll.mockReset().mockResolvedValue({
    profiles_refreshed: 3,
    profiles_failed: 0,
    totals: {
      accounts_refreshed: 5,
      account_failures: 0,
      posts_refreshed: 80,
      post_failures: 0,
    },
  });
});

describe("GET /api/cron/social-analytics-refresh — auth", () => {
  it("401 when no Authorization header", async () => {
    const res = await GET(req("GET") as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("401 when bearer token doesn't match", async () => {
    mockConstantTimeEqual.mockReturnValue(false);
    const res = await GET(
      req("GET", "Bearer wrong-secret") as Parameters<typeof GET>[0],
    );
    expect(res.status).toBe(401);
    expect(mockRefreshAll).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/social-analytics-refresh — happy path", () => {
  beforeEach(() => {
    mockConstantTimeEqual.mockReturnValue(true);
  });

  it("200 with totals when BUNDLE_SOCIAL_API is configured", async () => {
    const res = await GET(
      req("GET", "Bearer secret") as Parameters<typeof GET>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.profiles_refreshed).toBe(3);
    expect(body.data.totals.accounts_refreshed).toBe(5);
  });

  it("207 when some profiles failed", async () => {
    mockRefreshAll.mockResolvedValue({
      profiles_refreshed: 2,
      profiles_failed: 1,
      totals: {
        accounts_refreshed: 3,
        account_failures: 1,
        posts_refreshed: 30,
        post_failures: 2,
      },
    });
    const res = await GET(
      req("GET", "Bearer secret") as Parameters<typeof GET>[0],
    );
    expect(res.status).toBe(207);
  });

  it("200 'skipped' no-op when BUNDLE_SOCIAL_API is unset", async () => {
    delete process.env.BUNDLE_SOCIAL_API;
    const res = await GET(
      req("GET", "Bearer secret") as Parameters<typeof GET>[0],
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("skipped");
    expect(mockRefreshAll).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/social-analytics-refresh — alias", () => {
  it("supports POST as well as GET (matches Vercel cron flexibility)", async () => {
    mockConstantTimeEqual.mockReturnValue(true);
    const res = await POST(
      req("POST", "Bearer secret") as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
  });
});
