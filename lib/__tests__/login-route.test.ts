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
// M2c-2 — POST /api/auth/login.
//
// Pins the response contract for the login route handler:
//   - 400 VALIDATION_FAILED when the body is missing email or password.
//   - 401 INVALID_CREDENTIALS when supabase rejects the password.
//   - 200 {ok:true, data:{next}} on success.
//   - open-redirect guard: absolute / protocol-relative `next` values
//     are sanitised to /admin/sites on success.
//
// Cookie-setting side effects are not asserted here — that's the SSR
// adapter's job and it's pinned separately by middleware.test.ts's
// buildSessionCookies path. This test uses a plain supabase-js client
// so we can exercise the route handler outside a Next request scope.
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
          "login-route.test: mockState.client not set before POST",
        );
      }
      return mockState.client;
    },
  };
});

const { POST: loginPOST } = await import("@/app/api/auth/login/route");

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "login-route.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockState.client = anonClient();
});

afterEach(() => {
  mockState.client = null;
});

describe("POST /api/auth/login", () => {
  it("returns 400 VALIDATION_FAILED when email is missing", async () => {
    const res = await loginPOST(makeRequest({ password: "x" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 VALIDATION_FAILED when email is malformed", async () => {
    const res = await loginPOST(
      makeRequest({ email: "not-an-email", password: "x" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 VALIDATION_FAILED when password is missing", async () => {
    const res = await loginPOST(makeRequest({ email: "a@b.test" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when the body is not JSON", async () => {
    const req = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    const res = await loginPOST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 INVALID_CREDENTIALS on wrong password", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const res = await loginPOST(
      makeRequest({ email: user.email, password: "the-wrong-password" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    // No account-enumeration oracle: message is generic.
    expect(body.error.message).toBe("Invalid email or password.");
  });

  it("returns 401 INVALID_CREDENTIALS for an unknown email", async () => {
    const res = await loginPOST(
      makeRequest({
        email: "no-such-user@opollo.test",
        password: "test-password-1234",
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("returns 200 with next on successful sign-in", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const res = await loginPOST(
      makeRequest({
        email: user.email,
        password: "test-password-1234",
        next: "/admin/sites",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.next).toBe("/admin/sites");
  });

  it("sanitises an absolute next URL to /admin/sites (open-redirect guard)", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const res = await loginPOST(
      makeRequest({
        email: user.email,
        password: "test-password-1234",
        next: "https://evil.example/steal",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.next).toBe("/admin/sites");
  });

  it("sanitises a protocol-relative next to /admin/sites", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const res = await loginPOST(
      makeRequest({
        email: user.email,
        password: "test-password-1234",
        next: "//evil.example/steal",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.next).toBe("/admin/sites");
  });

  it("defaults next to /admin/sites when omitted", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const res = await loginPOST(
      makeRequest({
        email: user.email,
        password: "test-password-1234",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.next).toBe("/admin/sites");
  });
});
