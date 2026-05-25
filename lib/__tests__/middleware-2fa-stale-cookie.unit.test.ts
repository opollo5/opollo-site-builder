import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// middleware — opollo_2fa_pending stale-cookie gate.
//
// When AUTH_2FA_ENABLED is off and the browser has a stale
// opollo_2fa_pending cookie (left over from a prior session when the
// flag was on), middleware must:
//   1. Clear opollo_2fa_pending + opollo_pending_device_id cookies.
//   2. NOT redirect to /login/check-email.
//
// When AUTH_2FA_ENABLED is on, middleware must redirect non-exempted
// paths to /login/check-email even if the session is authenticated.
//
// This test pins the flag-check fix in supabaseAuthGate — the guard
// that was missing before (middleware always redirected on the cookie's
// presence regardless of flag state).
// ---------------------------------------------------------------------------

const mockGetUser = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { user: { id: "mw-stale-cookie-test-user" } },
    error: null,
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
const ORIG_2FA = process.env.AUTH_2FA_ENABLED;

beforeEach(() => {
  process.env.FEATURE_SUPABASE_AUTH = "true";
  delete process.env.AUTH_2FA_ENABLED;
  mockCreateMiddlewareAuthClient.mockImplementation(() => ({
    supabase: { auth: { getUser: mockGetUser } },
    response: NextResponse.next(),
  }));
});

afterEach(() => {
  if (ORIG_FEATURE === undefined) delete process.env.FEATURE_SUPABASE_AUTH;
  else process.env.FEATURE_SUPABASE_AUTH = ORIG_FEATURE;
  if (ORIG_2FA === undefined) delete process.env.AUTH_2FA_ENABLED;
  else process.env.AUTH_2FA_ENABLED = ORIG_2FA;
  vi.restoreAllMocks();
});

function makeRequest(pathname: string, cookieHeader = ""): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

describe("middleware — opollo_2fa_pending stale-cookie gate", () => {
  it("does NOT redirect when flag is off and stale cookie is present", async () => {
    const req = makeRequest("/admin/sites", "opollo_2fa_pending=stale-value");
    const res = await middleware(req);

    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("expires opollo_2fa_pending cookie when flag is off", async () => {
    const req = makeRequest("/admin/sites", "opollo_2fa_pending=stale-value");
    const res = await middleware(req);

    const cleared = res.cookies
      .getAll()
      .find((c) => c.name === "opollo_2fa_pending");
    expect(cleared).toBeDefined();
    expect(cleared?.value).toBe("");
  });

  it("expires opollo_pending_device_id cookie when flag is off", async () => {
    const req = makeRequest("/admin/sites", "opollo_2fa_pending=stale-value");
    const res = await middleware(req);

    const cleared = res.cookies
      .getAll()
      .find((c) => c.name === "opollo_pending_device_id");
    expect(cleared).toBeDefined();
    expect(cleared?.value).toBe("");
  });

  it("redirects to /login/check-email when flag is on and cookie is present", async () => {
    process.env.AUTH_2FA_ENABLED = "true";
    const req = makeRequest("/admin/sites", "opollo_2fa_pending=active-value");
    const res = await middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login/check-email");
  });

  it("passes through normally when no 2FA cookie is present", async () => {
    const req = makeRequest("/admin/sites");
    const res = await middleware(req);

    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });
});
