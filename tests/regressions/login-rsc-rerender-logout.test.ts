import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Regression: blank-after-login when AUTH_2FA_ENABLED=false and a stale
// opollo_2fa_pending cookie is present (Incident 20.x, 2026-05-26).
//
// Root cause: when loginAction returns { redirectTo } Next.js triggers an
// RSC re-render of /login/page.tsx in the SAME server-side request context.
// cookies() reads the INCOMING request cookies, not the Set-Cookie headers
// the action just wrote to the response. So cookies().has(PENDING_2FA_COOKIE)
// returns true even though the action cleared it in the outgoing headers.
// The page's stale-cookie guard fired redirect("/logout"), wiping the
// Supabase session — user ends back at /login with no session.
//
// Fix: gate the redirect("/logout") on is2faEnabled(). When the flag is
// off, the server action + middleware already handle stale cookies; the
// page-level guard must not run (it can't see the cleared outgoing cookie).
//
// Working analog: the 2FA challenge path uses redirect() (not return data)
// for the same reason in reverse — see login-action-hard-redirect.test.ts.
// ---------------------------------------------------------------------------

const mockCookiesHas = vi.hoisted(() => vi.fn());
const mockCookiesSet = vi.hoisted(() => vi.fn());
const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), {
      digest: "NEXT_REDIRECT",
    });
  }),
);
const mockGetCurrentUser = vi.hoisted(() => vi.fn());
const mockIsAuthKillSwitchOn = vi.hoisted(() => vi.fn().mockResolvedValue(false));

vi.mock("next/headers", () => ({
  cookies: () => ({
    has: mockCookiesHas,
    set: mockCookiesSet,
    get: vi.fn().mockReturnValue(undefined),
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: vi.fn(),
  getCurrentUser: mockGetCurrentUser,
}));
vi.mock("@/lib/auth-kill-switch", () => ({
  isAuthKillSwitchOn: mockIsAuthKillSwitchOn,
}));
vi.mock("@/lib/design-system/get-override", () => ({
  getDesignSystemCssOverride: vi.fn().mockResolvedValue(null),
}));

const ORIG_2FA = process.env.AUTH_2FA_ENABLED;
const ORIG_FEATURE = process.env.FEATURE_SUPABASE_AUTH;

beforeEach(() => {
  process.env.AUTH_2FA_ENABLED = "false";
  process.env.FEATURE_SUPABASE_AUTH = "true";
  mockCookiesHas.mockImplementation(
    (name: string) => name === "opollo_2fa_pending",
  );
  mockGetCurrentUser.mockResolvedValue(null);
});

afterEach(() => {
  if (ORIG_2FA === undefined) delete process.env.AUTH_2FA_ENABLED;
  else process.env.AUTH_2FA_ENABLED = ORIG_2FA;
  if (ORIG_FEATURE === undefined) delete process.env.FEATURE_SUPABASE_AUTH;
  else process.env.FEATURE_SUPABASE_AUTH = ORIG_FEATURE;
  vi.restoreAllMocks();
});

const { default: LoginPage } = await import("@/app/login/page");

describe("LoginPage — RSC re-render with stale 2FA cookie", () => {
  it("does NOT call redirect('/logout') when AUTH_2FA_ENABLED=false, even with stale cookie", async () => {
    // Simulate: flag off, stale cookie present, no active user session.
    // This is the post-server-action RSC re-render scenario.
    expect(process.env.AUTH_2FA_ENABLED).toBe("false");
    expect(mockCookiesHas("opollo_2fa_pending")).toBe(true);

    // Render the login page — must NOT throw NEXT_REDIRECT to /logout.
    let threw: string | null = null;
    try {
      await LoginPage({ searchParams: {} });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      threw = msg;
    }

    // No exception thrown at all = no redirect fired.
    expect(threw).toBeNull();

    // Belt-and-suspenders: redirect("/logout") must never be called.
    const logoutCalls = mockRedirect.mock.calls.filter(([u]) =>
      u.startsWith("/logout"),
    );
    expect(logoutCalls).toHaveLength(0);
  });

  it("DOES call redirect('/logout') when AUTH_2FA_ENABLED=true and stale cookie present", async () => {
    process.env.AUTH_2FA_ENABLED = "true";

    let threw: string | null = null;
    try {
      await LoginPage({ searchParams: {} });
    } catch (e: unknown) {
      threw = e instanceof Error ? e.message : String(e);
    }

    expect(threw).toContain("NEXT_REDIRECT:/logout");
  });
});
