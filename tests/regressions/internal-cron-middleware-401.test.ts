import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Regression: /api/internal/cron/* must not be blocked by the auth gate.
//
// When the V2 publish-due cron was added at /api/internal/cron/publish-due,
// the middleware only exempted /api/cron/* but not /api/internal/cron/*.
// Vercel cron ticks hit the edge middleware before reaching the route handler.
// Under FEATURE_SUPABASE_AUTH=true the middleware returned 401 (no session).
// Under Basic Auth mode it also returned 401 (CRON_SECRET uses Bearer, not Basic).
// The cron fired every minute and always failed silently — no posts published.
//
// Fix: isPublicPath() now also exempts /api/internal/cron/*, and basicAuthGate
// passes through both /api/cron/ and /api/internal/cron/ without Basic check.
// ---------------------------------------------------------------------------

const mockGetUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { user: null },
    error: { message: "no session" },
  }),
);
const mockCreateMiddlewareAuthClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  createMiddlewareAuthClient: mockCreateMiddlewareAuthClient,
}));
vi.mock("@/lib/auth-kill-switch", () => ({
  isAuthKillSwitchOn: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/security-headers", () => ({
  applySecurityHeaders: vi.fn((res: NextResponse) => res),
  ensureRequestId: vi.fn().mockReturnValue("test-request-id"),
}));

const { middleware } = await import("@/middleware");

const ORIG_FEATURE = process.env.FEATURE_SUPABASE_AUTH;
const ORIG_BASIC_USER = process.env.BASIC_AUTH_USER;
const ORIG_BASIC_PASS = process.env.BASIC_AUTH_PASSWORD;

beforeEach(() => {
  mockCreateMiddlewareAuthClient.mockImplementation(() => ({
    supabase: { auth: { getUser: mockGetUser } },
    response: NextResponse.next(),
  }));
});

afterEach(() => {
  if (ORIG_FEATURE === undefined) delete process.env.FEATURE_SUPABASE_AUTH;
  else process.env.FEATURE_SUPABASE_AUTH = ORIG_FEATURE;
  if (ORIG_BASIC_USER === undefined) delete process.env.BASIC_AUTH_USER;
  else process.env.BASIC_AUTH_USER = ORIG_BASIC_USER;
  if (ORIG_BASIC_PASS === undefined) delete process.env.BASIC_AUTH_PASSWORD;
  else process.env.BASIC_AUTH_PASSWORD = ORIG_BASIC_PASS;
  vi.restoreAllMocks();
});

function makeRequest(pathname: string, headers?: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, { headers });
}

describe("middleware — /api/internal/cron/* exempt from auth gate", () => {
  describe("Supabase Auth path (FEATURE_SUPABASE_AUTH=true)", () => {
    beforeEach(() => {
      process.env.FEATURE_SUPABASE_AUTH = "true";
    });

    it("does NOT return 401 for /api/internal/cron/publish-due without a session", async () => {
      const res = await middleware(makeRequest("/api/internal/cron/publish-due"));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(307);
    });

    it("does NOT return 401 for /api/internal/cron/heartbeat-check without a session", async () => {
      const res = await middleware(makeRequest("/api/internal/cron/heartbeat-check"));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(307);
    });

    it("does NOT return 401 for /api/internal/cron/health-check without a session", async () => {
      const res = await middleware(makeRequest("/api/internal/cron/health-check"));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(307);
    });

    it("still blocks /api/internal/other without a session", async () => {
      const res = await middleware(makeRequest("/api/internal/other"));
      expect(res.status).toBe(401);
    });
  });

  describe("Basic Auth path (FEATURE_SUPABASE_AUTH=false, credentials set)", () => {
    beforeEach(() => {
      process.env.FEATURE_SUPABASE_AUTH = "false";
      process.env.BASIC_AUTH_USER = "admin";
      process.env.BASIC_AUTH_PASSWORD = "password";
    });

    it("does NOT return 401 for /api/internal/cron/publish-due with Bearer CRON_SECRET", async () => {
      const res = await middleware(
        makeRequest("/api/internal/cron/publish-due", {
          authorization: "Bearer test-cron-secret",
        }),
      );
      expect(res.status).not.toBe(401);
    });

    it("does NOT return 401 for /api/cron/ with Bearer CRON_SECRET", async () => {
      const res = await middleware(
        makeRequest("/api/cron/social-publish-watchdog", {
          authorization: "Bearer test-cron-secret",
        }),
      );
      expect(res.status).not.toBe(401);
    });

    it("still blocks non-cron /api/ paths without Basic Auth", async () => {
      const res = await middleware(makeRequest("/api/platform/social/posts"));
      expect(res.status).toBe(401);
    });
  });
});
