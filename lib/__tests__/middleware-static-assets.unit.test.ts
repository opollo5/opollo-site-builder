import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// middleware — static asset passthrough.
//
// Regression test for the blank-login-page bug: /styles/ds.css and
// /fonts/linearicons/linearicons.css were being intercepted by middleware
// and returned as HTML redirects to /login?next=<path>. Browsers refused
// to apply HTML as CSS (MIME mismatch), rendering the page blank.
//
// Fix: isPublicPath() early-returns for /styles/, /fonts/, /api/uat/, and
// any path with a static-file extension. The matcher config also excludes
// these paths at the routing layer.
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

beforeEach(() => {
  process.env.FEATURE_SUPABASE_AUTH = "true";
  mockCreateMiddlewareAuthClient.mockImplementation(() => ({
    supabase: { auth: { getUser: mockGetUser } },
    response: NextResponse.next(),
  }));
});

afterEach(() => {
  if (ORIG_FEATURE === undefined) delete process.env.FEATURE_SUPABASE_AUTH;
  else process.env.FEATURE_SUPABASE_AUTH = ORIG_FEATURE;
  vi.restoreAllMocks();
});

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`);
}

describe("middleware — static asset passthrough (no session)", () => {
  it("does NOT redirect /styles/ds.css", async () => {
    const res = await middleware(makeRequest("/styles/ds.css"));
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(302);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect /fonts/linearicons/linearicons.css", async () => {
    const res = await middleware(makeRequest("/fonts/linearicons/linearicons.css"));
    expect(res.status).not.toBe(307);
    expect(res.status).not.toBe(302);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect a .woff2 font file", async () => {
    const res = await middleware(makeRequest("/fonts/inter/inter.woff2"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect a .svg icon", async () => {
    const res = await middleware(makeRequest("/styles/icons/logo.svg"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect /api/uat/* endpoints", async () => {
    const res = await middleware(makeRequest("/api/uat/sign-in"));
    expect(res.status).not.toBe(307);
    expect(res.headers.get("location")).toBeNull();
  });

  it("DOES redirect an unprotected admin path with no session", async () => {
    const res = await middleware(makeRequest("/admin/sites"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});
