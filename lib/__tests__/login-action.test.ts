import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// Server Action backing the /login form.
//
// Same ground the old /api/auth/login route tests covered (validation,
// generic invalid-creds message, success) but routed through the
// Server Action path the UI actually uses. The API route test file
// stays so the JSON endpoint remains pinned for programmatic callers.
//
// redirect() from next/navigation throws a NEXT_REDIRECT error to
// unwind the server action — we catch and assert on the error's
// digest rather than mocking next/navigation.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
}));

vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => {
      if (!mockState.client) {
        throw new Error(
          "login-action.test: mockState.client not set before loginAction",
        );
      }
      return mockState.client;
    },
  };
});

// next/headers throws "called outside a request scope" in unit tests.
// The server action reads headers() only to extract the caller IP for
// the rate limiter; stubbing to an empty Headers makes the limiter
// see "ip:unknown" (shared-bucket fail-open path — already pinned by
// rate-limit.test.ts).
vi.mock("next/headers", () => ({
  headers: () => new Headers(),
}));

const { loginAction } = await import("@/app/login/actions");

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "login-action.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function buildFormData(
  fields: Record<string, string | undefined>,
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) fd.set(k, v);
  }
  return fd;
}

// redirect() throws a NEXT_REDIRECT digest that includes the target
// path. Returns the path on a redirect, or null if the action returned
// normally (validation/auth error).
async function runAction(
  fd: FormData,
): Promise<{ redirected: string | null; state: { error?: string } | null }> {
  try {
    const state = await loginAction({}, fd);
    return { redirected: null, state };
  } catch (err) {
    // Next's redirect() throws an error whose `digest` starts with
    // "NEXT_REDIRECT;<type>;<url>;<status>". Parse out the URL so the
    // test can assert on it.
    const digest = (err as { digest?: string }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
      const parts = digest.split(";");
      // parts: ["NEXT_REDIRECT", "replace"|"push", "<url>", "<status>"]
      const url = parts[2] ?? "";
      return { redirected: url, state: null };
    }
    throw err;
  }
}

beforeEach(() => {
  mockState.client = anonClient();
});

afterEach(() => {
  mockState.client = null;
});

describe("loginAction", () => {
  it("returns error when email is missing", async () => {
    const result = await runAction(buildFormData({ password: "x" }));
    expect(result.redirected).toBeNull();
    expect(result.state?.error).toBe("Email and password are required.");
  });

  it("returns error when password is missing", async () => {
    const result = await runAction(buildFormData({ email: "x@y.test" }));
    expect(result.redirected).toBeNull();
    expect(result.state?.error).toBe("Email and password are required.");
  });

  it("returns generic invalid message on wrong password", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const result = await runAction(
      buildFormData({
        email: user.email,
        password: "definitely-not-the-password",
      }),
    );
    expect(result.redirected).toBeNull();
    expect(result.state?.error).toBe("Invalid email or password.");
  });

  it("returns the same generic message for an unknown email", async () => {
    const result = await runAction(
      buildFormData({
        email: "ghost@opollo.test",
        password: "test-password-1234",
      }),
    );
    expect(result.redirected).toBeNull();
    expect(result.state?.error).toBe("Invalid email or password.");
  });

  it("redirects to next on successful sign-in", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const result = await runAction(
      buildFormData({
        email: user.email,
        password: "test-password-1234",
        next: "/admin/sites",
      }),
    );
    expect(result.redirected).toBe("/admin/sites");
  });

  it("sanitises a malicious next to /admin/sites", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const result = await runAction(
      buildFormData({
        email: user.email,
        password: "test-password-1234",
        next: "https://evil.example/steal",
      }),
    );
    expect(result.redirected).toBe("/admin/sites");
  });

  it("sanitises a protocol-relative next to /admin/sites", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const result = await runAction(
      buildFormData({
        email: user.email,
        password: "test-password-1234",
        next: "//evil.example",
      }),
    );
    expect(result.redirected).toBe("/admin/sites");
  });

  it("defaults next to /admin/sites when omitted", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const result = await runAction(
      buildFormData({
        email: user.email,
        password: "test-password-1234",
      }),
    );
    expect(result.redirected).toBe("/admin/sites");
  });
});
