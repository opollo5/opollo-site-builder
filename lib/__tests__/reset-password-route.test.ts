import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M14-3 — POST /api/auth/reset-password.
//
// Unit-level test with a mocked auth client + mocked getCurrentUser.
// Assertion matrix:
//
//   1. Missing / malformed body → 400 VALIDATION_FAILED.
//   2. Weak password (< 12 chars) → 422 PASSWORD_WEAK, updateUser NOT called.
//   3. No session → 401 UNAUTHORIZED, updateUser NOT called.
//   4. supabase.auth.updateUser returns "same_password" → 422 SAME_PASSWORD.
//   5. supabase.auth.updateUser returns a generic error → 422 UPDATE_FAILED.
//   6. Happy path → 200 + updateUser called once with the new password.
//   7. Password never appears in any logger invocation.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  updateResult: { error: null as { message: string } | null },
  updateCalls: [] as Array<{ attributes: { password: string } }>,
}));

vi.mock("@/lib/auth", async () => ({
  createRouteAuthClient: () => ({
    auth: {
      updateUser: async (attributes: { password: string }) => {
        mockState.updateCalls.push({ attributes });
        return mockState.updateResult;
      },
    },
  }),
  getCurrentUser: async () => mockState.user,
}));

const loggerCalls = vi.hoisted(() => ({
  info: [] as Array<[string, Record<string, unknown> | undefined]>,
  warn: [] as Array<[string, Record<string, unknown> | undefined]>,
  error: [] as Array<[string, Record<string, unknown> | undefined]>,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: () => {},
    info: (msg: string, fields?: Record<string, unknown>) =>
      loggerCalls.info.push([msg, fields]),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      loggerCalls.warn.push([msg, fields]),
    error: (msg: string, fields?: Record<string, unknown>) =>
      loggerCalls.error.push([msg, fields]),
  },
}));

import { POST as resetPasswordPOST } from "@/app/api/auth/reset-password/route";

const USER_UUID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const VALID_PASSWORD = "correct-horse-battery-staple";

beforeEach(() => {
  mockState.user = { id: USER_UUID, email: "hi@opollo.com" };
  mockState.updateResult = { error: null };
  mockState.updateCalls = [];
  loggerCalls.info.length = 0;
  loggerCalls.warn.length = 0;
  loggerCalls.error.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(body: unknown): Request {
  return new Request("https://opollo.vercel.app/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/auth/reset-password: validation", () => {
  it("returns 400 when body has no new_password", async () => {
    const res = await resetPasswordPOST(makeRequest({}) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 422 PASSWORD_WEAK when password is shorter than 12 chars", async () => {
    const res = await resetPasswordPOST(
      makeRequest({ new_password: "short-11-ch" }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PASSWORD_WEAK");
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request(
      "https://opollo.vercel.app/api/auth/reset-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      },
    );
    const res = await resetPasswordPOST(req as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/reset-password: session gating", () => {
  it("returns 401 when no session is present", async () => {
    mockState.user = null;
    const res = await resetPasswordPOST(
      makeRequest({ new_password: VALID_PASSWORD }) as never,
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe("POST /api/auth/reset-password: supabase errors", () => {
  it("returns 422 SAME_PASSWORD when supabase rejects same-password", async () => {
    mockState.updateResult = {
      error: { message: "same_password: New password must be different" },
    };
    const res = await resetPasswordPOST(
      makeRequest({ new_password: VALID_PASSWORD }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("SAME_PASSWORD");
  });

  it("returns 422 UPDATE_FAILED on a generic supabase error", async () => {
    mockState.updateResult = { error: { message: "random failure" } };
    const res = await resetPasswordPOST(
      makeRequest({ new_password: VALID_PASSWORD }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UPDATE_FAILED");
  });
});

describe("POST /api/auth/reset-password: happy path", () => {
  it("returns 200 and calls updateUser exactly once", async () => {
    const res = await resetPasswordPOST(
      makeRequest({ new_password: VALID_PASSWORD }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user_id).toBe(USER_UUID);

    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0].attributes.password).toBe(VALID_PASSWORD);
  });

  it("logs the success event with user_id and email (no password)", async () => {
    await resetPasswordPOST(
      makeRequest({ new_password: VALID_PASSWORD }) as never,
    );
    const success = loggerCalls.info.find(
      ([msg]) => msg === "reset_password_success",
    );
    expect(success).toBeDefined();
    const [, fields] = success as [string, Record<string, unknown>];
    expect(fields.user_id).toBe(USER_UUID);
    expect(fields.email).toBe("hi@opollo.com");
  });

  it("never logs the password in any logger invocation", async () => {
    await resetPasswordPOST(
      makeRequest({ new_password: VALID_PASSWORD }) as never,
    );
    const all = [
      ...loggerCalls.info,
      ...loggerCalls.warn,
      ...loggerCalls.error,
    ];
    expect(JSON.stringify(all)).not.toContain(VALID_PASSWORD);
  });
});
