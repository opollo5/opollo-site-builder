import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M14-4 — POST /api/account/change-password.
//
// Unit-level test — mocks the authed route client, getCurrentUser,
// the ephemeral anon client used for current-password verification,
// and the rate limiter. Matrix:
//
//   1. Missing / malformed body → 400 VALIDATION_FAILED.
//   2. No session → 401 UNAUTHORIZED, no verification / update calls.
//   3. Rate-limit exceeded → 429, no verification / update calls.
//   4. Weak new password → 422 PASSWORD_WEAK before verification.
//   5. New == current (pre-check) → 422 SAME_PASSWORD before verification.
//   6. Wrong current password → 403 INCORRECT_CURRENT_PASSWORD, no update.
//   7. supabase.auth.updateUser → same_password error → 422 SAME_PASSWORD.
//   8. supabase.auth.updateUser → generic error → 422 UPDATE_FAILED.
//   9. Happy path → 200 + updateUser called once.
//  10. Password never appears in any logger invocation.
//  11. Current-password check uses an ephemeral client (persistSession=false).
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  verifyResult: true,
  verifyCalls: [] as Array<{ email: string; password: string }>,
  verifyClientOptions: [] as unknown[],
  updateResult: { error: null as { message: string } | null },
  updateCalls: [] as Array<{ attributes: { password: string } }>,
  rateLimitOk: true,
  rateLimitCalls: [] as Array<{ name: string; identifier: string }>,
}));

vi.mock("@/lib/auth", () => ({
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

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: unknown) => {
    mockState.verifyClientOptions.push(options);
    return {
      auth: {
        signInWithPassword: async ({
          email,
          password,
        }: {
          email: string;
          password: string;
        }) => {
          mockState.verifyCalls.push({ email, password });
          return mockState.verifyResult
            ? { data: { user: { id: "x" } }, error: null }
            : { data: { user: null }, error: { message: "invalid" } };
        },
      },
    };
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (name: string, identifier: string) => {
    mockState.rateLimitCalls.push({ name, identifier });
    if (mockState.rateLimitOk) {
      return { ok: true, limit: 10, remaining: 9, reset: 0 };
    }
    return {
      ok: false,
      limit: 10,
      remaining: 0,
      reset: Date.now() + 60_000,
      retryAfterSec: 60,
    };
  },
  rateLimitExceeded: () =>
    new Response(
      JSON.stringify({ ok: false, error: { code: "RATE_LIMITED" } }),
      { status: 429, headers: { "content-type": "application/json" } },
    ),
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

import { POST as changePasswordPOST } from "@/app/api/account/change-password/route";

const USER_UUID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const CURRENT_PASSWORD = "current-pass-1234";
const NEW_PASSWORD = "new-pass-5678-very-strong";

beforeEach(() => {
  mockState.user = { id: USER_UUID, email: "op@opollo.com" };
  mockState.verifyResult = true;
  mockState.verifyCalls = [];
  mockState.verifyClientOptions = [];
  mockState.updateResult = { error: null };
  mockState.updateCalls = [];
  mockState.rateLimitOk = true;
  mockState.rateLimitCalls = [];
  loggerCalls.info.length = 0;
  loggerCalls.warn.length = 0;
  loggerCalls.error.length = 0;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key-for-tests";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRequest(body: unknown): Request {
  return new Request(
    "https://opollo.vercel.app/api/account/change-password",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

describe("POST /api/account/change-password: validation + auth", () => {
  it("returns 400 when body is missing fields", async () => {
    const res = await changePasswordPOST(makeRequest({}) as never);
    expect(res.status).toBe(400);
    expect(mockState.verifyCalls).toHaveLength(0);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request(
      "https://opollo.vercel.app/api/account/change-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      },
    );
    const res = await changePasswordPOST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 401 when no session is present", async () => {
    mockState.user = null;
    const res = await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(res.status).toBe(401);
    expect(mockState.verifyCalls).toHaveLength(0);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 429 when the rate limiter denies", async () => {
    mockState.rateLimitOk = false;
    const res = await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(res.status).toBe(429);
    expect(mockState.verifyCalls).toHaveLength(0);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe("POST /api/account/change-password: policy + same-password", () => {
  it("returns 422 PASSWORD_WEAK when new_password is too short (before verification)", async () => {
    const res = await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: "short-11-ch",
      }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("PASSWORD_WEAK");
    expect(mockState.verifyCalls).toHaveLength(0);
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("returns 422 SAME_PASSWORD when new == current (before verification)", async () => {
    const res = await changePasswordPOST(
      makeRequest({
        current_password: NEW_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("SAME_PASSWORD");
    expect(mockState.verifyCalls).toHaveLength(0);
    expect(mockState.updateCalls).toHaveLength(0);
  });
});

describe("POST /api/account/change-password: current-password verification", () => {
  it("returns 403 INCORRECT_CURRENT_PASSWORD when verification fails", async () => {
    mockState.verifyResult = false;
    const res = await changePasswordPOST(
      makeRequest({
        current_password: "wrong-current-1234",
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("INCORRECT_CURRENT_PASSWORD");
    expect(mockState.updateCalls).toHaveLength(0);
  });

  it("uses an ephemeral anon client (persistSession=false) for verification", async () => {
    await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(mockState.verifyClientOptions).toHaveLength(1);
    const opts = mockState.verifyClientOptions[0] as {
      auth: { persistSession: boolean; autoRefreshToken: boolean };
    };
    expect(opts.auth.persistSession).toBe(false);
    expect(opts.auth.autoRefreshToken).toBe(false);
  });
});

describe("POST /api/account/change-password: update errors", () => {
  it("returns 422 SAME_PASSWORD when supabase.updateUser complains about sameness", async () => {
    mockState.updateResult = {
      error: { message: "same_password: must differ" },
    };
    const res = await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("SAME_PASSWORD");
  });

  it("returns 422 UPDATE_FAILED on a generic supabase error", async () => {
    mockState.updateResult = { error: { message: "service unavailable" } };
    const res = await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("UPDATE_FAILED");
  });
});

describe("POST /api/account/change-password: happy path", () => {
  it("returns 200 and calls updateUser exactly once", async () => {
    const res = await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user_id).toBe(USER_UUID);

    expect(mockState.verifyCalls).toEqual([
      { email: "op@opollo.com", password: CURRENT_PASSWORD },
    ]);
    expect(mockState.updateCalls).toHaveLength(1);
    expect(mockState.updateCalls[0].attributes.password).toBe(NEW_PASSWORD);
  });

  it("logs change_password_success with user_id + email (no passwords)", async () => {
    await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    const success = loggerCalls.info.find(
      ([msg]) => msg === "change_password_success",
    );
    expect(success).toBeDefined();
    const [, fields] = success as [string, Record<string, unknown>];
    expect(fields.user_id).toBe(USER_UUID);
    expect(fields.email).toBe("op@opollo.com");
  });

  it("never logs either password in any logger invocation", async () => {
    await changePasswordPOST(
      makeRequest({
        current_password: CURRENT_PASSWORD,
        new_password: NEW_PASSWORD,
      }) as never,
    );
    const all = [
      ...loggerCalls.info,
      ...loggerCalls.warn,
      ...loggerCalls.error,
    ];
    const serialised = JSON.stringify(all);
    expect(serialised).not.toContain(CURRENT_PASSWORD);
    expect(serialised).not.toContain(NEW_PASSWORD);
  });
});
