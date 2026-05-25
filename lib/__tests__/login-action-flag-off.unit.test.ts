import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// loginAction — flag-off cookie-clearing behaviour.
//
// When AUTH_2FA_ENABLED is off (the default) and a user signs in
// successfully, the action must:
//   1. Return { redirectTo } (no challenge).
//   2. Expire any stale opollo_2fa_pending + opollo_pending_device_id
//      cookies from a prior session when the flag was on.
//
// Without step 2, middleware sees the leftover opollo_2fa_pending cookie
// and redirects every admin navigation back to /login/check-email even
// though no challenge is pending. This test pins the fix.
// ---------------------------------------------------------------------------

// Capture cookies().set() calls without a real request scope.
const cookieSets = vi.hoisted(
  () => [] as Array<{ name: string; value: string; opts: Record<string, unknown> }>,
);

vi.mock("next/headers", () => ({
  headers: () => new Headers(),
  cookies: () => ({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(
      (name: string, value: string, opts: Record<string, unknown>) => {
        cookieSets.push({ name, value, opts });
      },
    ),
  }),
}));

// Mock Supabase client — successful sign-in.
const mockSignIn = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { user: { id: "flag-off-test-user" }, session: { access_token: "t" } },
    error: null,
  }),
);

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => ({ auth: { signInWithPassword: mockSignIn } }),
  };
});

// Mock 2FA modules so they don't require a real DB even though the flag is
// off and these code paths are never reached.
vi.mock("@/lib/2fa/challenges", () => ({
  createLoginChallenge: vi.fn(),
  recentChallengeCountForUser: vi.fn(),
}));
vi.mock("@/lib/2fa/cookies", () => ({
  DEVICE_ID_COOKIE: "opollo_device_id",
  PENDING_2FA_COOKIE: "opollo_2fa_pending",
  decodeDeviceCookie: vi.fn().mockReturnValue(null),
  encodePending2faCookie: vi.fn(),
  getPending2faCookieMaxAgeSeconds: vi.fn().mockReturnValue(1200),
}));
vi.mock("@/lib/2fa/devices", () => ({
  isDeviceTrusted: vi.fn(),
  touchTrustedDevice: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ ok: true, retryAfterSec: 0 }),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
vi.mock("@/lib/auth-redirect", () => ({
  buildAuthRedirectUrl: (path: string) => `http://localhost:3000${path}`,
}));
vi.mock("@/lib/email/sendgrid", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/templates/login-approval", () => ({
  renderLoginApprovalEmail: vi.fn().mockReturnValue({ subject: "s", html: "h" }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

const { loginAction } = await import("@/app/login/actions");

function buildFd(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const ORIG_2FA = process.env.AUTH_2FA_ENABLED;

beforeEach(() => {
  cookieSets.length = 0;
  delete process.env.AUTH_2FA_ENABLED;
});

afterEach(() => {
  if (ORIG_2FA === undefined) {
    delete process.env.AUTH_2FA_ENABLED;
  } else {
    process.env.AUTH_2FA_ENABLED = ORIG_2FA;
  }
  vi.restoreAllMocks();
});

describe("loginAction — AUTH_2FA_ENABLED off", () => {
  it("returns redirectTo without triggering a challenge", async () => {
    const result = await loginAction(
      {},
      buildFd({ email: "user@test.com", password: "correct-pw" }),
    );
    expect(result.redirectTo).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it("expires opollo_2fa_pending cookie on the flag-off path", async () => {
    await loginAction(
      {},
      buildFd({ email: "user@test.com", password: "correct-pw" }),
    );
    const pendingClear = cookieSets.find((c) => c.name === "opollo_2fa_pending");
    expect(pendingClear).toBeDefined();
    expect(pendingClear?.value).toBe("");
    expect(pendingClear?.opts.maxAge).toBe(0);
  });

  it("expires opollo_pending_device_id cookie on the flag-off path", async () => {
    await loginAction(
      {},
      buildFd({ email: "user@test.com", password: "correct-pw" }),
    );
    const deviceClear = cookieSets.find(
      (c) => c.name === "opollo_pending_device_id",
    );
    expect(deviceClear).toBeDefined();
    expect(deviceClear?.value).toBe("");
    expect(deviceClear?.opts.maxAge).toBe(0);
  });

  it("does NOT clear cookies when sign-in fails (wrong password)", async () => {
    mockSignIn.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });
    await loginAction(
      {},
      buildFd({ email: "user@test.com", password: "wrong-pw" }),
    );
    expect(cookieSets).toHaveLength(0);
  });
});
