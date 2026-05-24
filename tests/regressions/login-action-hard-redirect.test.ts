import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { redirect } from "next/navigation";
import { decodeDeviceCookie } from "@/lib/2fa/cookies";
import { isDeviceTrusted } from "@/lib/2fa/devices";

// ---------------------------------------------------------------------------
// Regression: loginAction returns { redirectTo } instead of calling
// next/navigation redirect() so the client can do window.location.assign
// (Bug 2 — login hangs on "Signing in…").
//
// Root cause: next/navigation redirect() triggers a soft RSC navigation
// from useFormState. The browser doesn't re-read Set-Cookie headers on
// a soft navigation, so middleware sees no session cookie and redirects
// the user back to /login, producing a stuck "Signing in…" state.
//
// Fix: the action returns { redirectTo: string } and LoginForm.tsx calls
// window.location.assign(state.redirectTo) — a hard navigation that
// guarantees middleware sees the new session cookies.
//
// Working analog: CheckEmailPolling.tsx (line 95) uses window.location.assign
// with the same rationale comment ("a hard navigation guarantees middleware
// sees the cleared cookies before /admin/sites renders").
//
// See also: Case A/B below (Incident 20.6) — the 2FA challenge path must
// use redirect() (not return { redirectTo }) to avoid the Incident 20.4
// stale-cookie guard in /login/page.tsx firing on the cookie just set.
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), {
      digest: `NEXT_REDIRECT;replace;${url};303;`,
    });
  }),
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: () => ({
    auth: {
      signInWithPassword: async ({
        email,
        password,
      }: {
        email: string;
        password: string;
      }) => {
        if (email === "ok@test.com" && password === "correct-password") {
          return { data: { user: { id: "uid-1" } }, error: null };
        }
        return {
          data: { user: null },
          error: { message: "Invalid login credentials" },
        };
      },
    },
  }),
}));

vi.mock("next/headers", () => ({
  headers: () => new Headers(),
  // cookies() is only reached in the 2FA block; 2FA is off in the no-2FA
  // tests because AUTH_2FA_ENABLED env is unset. Used in the 2FA tests below.
  cookies: () => ({
    get: () => undefined,
    set: () => {},
    has: () => false,
  }),
}));

vi.mock("@/lib/2fa/cookies", () => ({
  DEVICE_ID_COOKIE: "opollo_device_id",
  PENDING_2FA_COOKIE: "opollo_2fa_pending",
  decodeDeviceCookie: vi.fn().mockReturnValue(null),
  encodePending2faCookie: vi.fn((id: string) => `signed:${id}`),
  getPending2faCookieMaxAgeSeconds: vi.fn().mockReturnValue(1200),
}));

vi.mock("@/lib/2fa/devices", () => ({
  isDeviceTrusted: vi.fn().mockResolvedValue(false),
  touchTrustedDevice: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/2fa/challenges", () => ({
  recentChallengeCountForUser: vi.fn().mockResolvedValue(0),
  createLoginChallenge: vi.fn().mockResolvedValue({
    ok: true,
    challenge_id: "chal-test-1",
    raw_token: "raw-token-abc",
    expires_at: "2026-06-01T00:00:00Z",
    device_id: "dev-test-1",
  }),
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/auth-redirect", () => ({
  buildAuthRedirectUrl: vi.fn((path: string) => `https://app.example.com${path}`),
}));

vi.mock("@/lib/email/templates/login-approval", () => ({
  renderLoginApprovalEmail: vi.fn().mockReturnValue({
    subject: "Approve your sign-in",
    html: "<p>Approve</p>",
    text: "Approve",
  }),
}));

// is2faEnabled() reads AUTH_2FA_ENABLED; unset means false → direct login path.
// No need to mock the 2fa/flag module.

const { loginAction } = await import("@/app/login/actions");

function fd(
  fields: Record<string, string | undefined>,
): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) form.set(k, v);
  }
  return form;
}

describe("Regression: loginAction returns { redirectTo } (Bug 2 — Signing in… hang)", () => {
  it("returns { redirectTo: next } on successful sign-in (no 2FA)", async () => {
    const result = await loginAction(
      {},
      fd({ email: "ok@test.com", password: "correct-password", next: "/admin/sites" }),
    );
    // Must NOT throw NEXT_REDIRECT — returns a plain object instead.
    expect(result).toEqual({ redirectTo: "/admin/sites" });
    expect(result.redirectTo).toBe("/admin/sites");
  });

  it("defaults redirectTo to /admin/sites when next is omitted", async () => {
    const result = await loginAction(
      {},
      fd({ email: "ok@test.com", password: "correct-password" }),
    );
    expect(result.redirectTo).toBe("/admin/sites");
  });

  it("sanitises a malicious next — redirectTo falls back to /admin/sites", async () => {
    const result = await loginAction(
      {},
      fd({
        email: "ok@test.com",
        password: "correct-password",
        next: "https://evil.example/steal",
      }),
    );
    expect(result.redirectTo).toBe("/admin/sites");
  });

  it("returns { error } (no redirectTo) on wrong password", async () => {
    const result = await loginAction(
      {},
      fd({ email: "ok@test.com", password: "wrong" }),
    );
    expect(result.redirectTo).toBeUndefined();
    expect(result.error).toBe("Invalid email or password.");
  });

  it("returns { error } (no redirectTo) on missing email", async () => {
    const result = await loginAction({}, fd({ password: "pw" }));
    expect(result.redirectTo).toBeUndefined();
    expect(result.error).toBe("Email and password are required.");
  });
});

// ---------------------------------------------------------------------------
// Incident 20.6 — 2FA challenge path must use redirect(), not return { redirectTo }
//
// Root cause: when loginAction returned { redirectTo: checkEmailUrl } in the
// 2FA challenge branch, Next.js re-rendered /login/page.tsx server-side before
// sending the RSC response. That re-render hit the Incident 20.4 stale-cookie
// guard (app/login/page.tsx:52-54), which detected the opollo_2fa_pending cookie
// just set by the action and called redirect("/logout"), wiping the session.
// The browser went directly to /logout with no stop at /login/check-email.
//
// Fix: use redirect() (throws NEXT_REDIRECT) which bypasses the page re-render.
// The trusted-device and non-2FA paths correctly keep return { redirectTo }
// (window.location.assign from LoginForm.tsx) — those paths do NOT set
// opollo_2fa_pending, so the guard does not fire.
// See auth-decisions.md §20.6.
// ---------------------------------------------------------------------------

describe("Incident 20.6: 2FA challenge path — calls redirect() not return { redirectTo }", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_2FA_ENABLED", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Case A: 2FA on, untrusted device → challenge issued → redirect() throws NEXT_REDIRECT
  it("Case A: throws NEXT_REDIRECT to /login/check-email (not return { redirectTo })", async () => {
    // decodeDeviceCookie returns null by default (no device cookie present)
    await expect(
      loginAction({}, fd({ email: "ok@test.com", password: "correct-password" })),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(vi.mocked(redirect)).toHaveBeenCalledWith(
      expect.stringContaining("/login/check-email"),
    );
  });

  // Case B: 2FA on, trusted device → skip challenge → return { redirectTo } (not redirect())
  // The trusted-device path must NOT call redirect() because it does not set
  // opollo_2fa_pending, so there is no Incident 20.4 guard to collide with.
  it("Case B: trusted device — returns { redirectTo } without calling redirect()", async () => {
    vi.mocked(decodeDeviceCookie).mockReturnValueOnce("device-abc");
    vi.mocked(isDeviceTrusted).mockResolvedValueOnce(true);
    const result = await loginAction(
      {},
      fd({ email: "ok@test.com", password: "correct-password" }),
    );
    expect(result).toEqual({ redirectTo: "/admin/sites" });
    expect(vi.mocked(redirect)).not.toHaveBeenCalled();
  });
});
