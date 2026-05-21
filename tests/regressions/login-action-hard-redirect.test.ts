import { describe, expect, it, vi } from "vitest";

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
// ---------------------------------------------------------------------------

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
  // cookies() is only reached in the 2FA block; 2FA is off in these tests
  // because AUTH_2FA_ENABLED env is unset.
  cookies: () => ({
    get: () => undefined,
    set: () => {},
    has: () => false,
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
