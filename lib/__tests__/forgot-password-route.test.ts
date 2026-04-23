import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// M14-3 — POST /api/auth/forgot-password.
//
// Unit-level test with a mocked service-role client + mocked rate
// limiter. The assertion matrix:
//
//   1. Missing / malformed email → 400 VALIDATION_FAILED.
//   2. Rate-limit exceeded → 429 RATE_LIMITED, no supabase call.
//   3. Valid email → 200 success envelope + resetPasswordForEmail called.
//   4. Supabase error → 200 success envelope still (no-enumeration
//      guarantee), but warn-level log emitted.
//   5. Email is lowercased before both the rate-limit identifier and
//      the Supabase call.
//   6. redirectTo is built via buildAuthRedirectUrl → passes through to
//      supabase.
//   7. Log payload never contains the email as an unhashed value ---
//      logger.info("forgot_password_requested") receives { email } with
//      the lowercased address.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  resetResult: { error: null as { message: string } | null },
  resetCalls: [] as Array<{
    email: string;
    options: { redirectTo: string };
  }>,
  rateLimitOk: true,
  rateLimitCalls: [] as Array<{ name: string; identifier: string }>,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    auth: {
      resetPasswordForEmail: async (
        email: string,
        options: { redirectTo: string },
      ) => {
        mockState.resetCalls.push({ email, options });
        return mockState.resetResult;
      },
    },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async (name: string, identifier: string) => {
    mockState.rateLimitCalls.push({ name, identifier });
    if (mockState.rateLimitOk) {
      return { ok: true, limit: 5, remaining: 4, reset: 0 };
    }
    return {
      ok: false,
      limit: 5,
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

import { POST as forgotPasswordPOST } from "@/app/api/auth/forgot-password/route";

const originalEnvUrl = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  mockState.resetResult = { error: null };
  mockState.resetCalls = [];
  mockState.rateLimitOk = true;
  mockState.rateLimitCalls = [];
  loggerCalls.info.length = 0;
  loggerCalls.warn.length = 0;
  loggerCalls.error.length = 0;
  process.env.NEXT_PUBLIC_SITE_URL = "https://opollo.vercel.app";
});

afterEach(() => {
  if (originalEnvUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalEnvUrl;
  }
  vi.restoreAllMocks();
});

function makeRequest(body: unknown): Request {
  return new Request("https://opollo.vercel.app/api/auth/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/auth/forgot-password: validation", () => {
  it("returns 400 when body has no email", async () => {
    const res = await forgotPasswordPOST(makeRequest({}) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(mockState.resetCalls).toHaveLength(0);
  });

  it("returns 400 when email is malformed", async () => {
    const res = await forgotPasswordPOST(
      makeRequest({ email: "not-an-email" }) as never,
    );
    expect(res.status).toBe(400);
    expect(mockState.resetCalls).toHaveLength(0);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request(
      "https://opollo.vercel.app/api/auth/forgot-password",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "not-json",
      },
    );
    const res = await forgotPasswordPOST(req as never);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/forgot-password: rate limit", () => {
  it("returns 429 when the limiter denies", async () => {
    mockState.rateLimitOk = false;
    const res = await forgotPasswordPOST(
      makeRequest({ email: "hi@opollo.com" }) as never,
    );
    expect(res.status).toBe(429);
    expect(mockState.resetCalls).toHaveLength(0);
    const warn = loggerCalls.warn.find(
      ([msg]) => msg === "forgot_password_rate_limited",
    );
    expect(warn).toBeDefined();
  });

  it("keys the limiter on the normalised email", async () => {
    await forgotPasswordPOST(
      makeRequest({ email: "HI@Opollo.COM" }) as never,
    );
    expect(mockState.rateLimitCalls).toEqual([
      { name: "password_reset", identifier: "email:hi@opollo.com" },
    ]);
  });
});

describe("POST /api/auth/forgot-password: happy path", () => {
  it("returns 200 with a success envelope", async () => {
    const res = await forgotPasswordPOST(
      makeRequest({ email: "hi@opollo.com" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe("hi@opollo.com");
  });

  it("calls supabase.auth.resetPasswordForEmail exactly once", async () => {
    await forgotPasswordPOST(
      makeRequest({ email: "hi@opollo.com" }) as never,
    );
    expect(mockState.resetCalls).toHaveLength(1);
    expect(mockState.resetCalls[0].email).toBe("hi@opollo.com");
    expect(mockState.resetCalls[0].options.redirectTo).toContain(
      "/api/auth/callback",
    );
    expect(mockState.resetCalls[0].options.redirectTo).toContain(
      "next=%2Fauth%2Freset-password",
    );
  });

  it("normalises email to lowercase for the supabase call", async () => {
    await forgotPasswordPOST(
      makeRequest({ email: "HI@Opollo.COM" }) as never,
    );
    expect(mockState.resetCalls[0].email).toBe("hi@opollo.com");
  });

  it("logs the request at info level", async () => {
    await forgotPasswordPOST(
      makeRequest({ email: "hi@opollo.com" }) as never,
    );
    const info = loggerCalls.info.find(
      ([msg]) => msg === "forgot_password_requested",
    );
    expect(info).toBeDefined();
  });
});

describe("POST /api/auth/forgot-password: no-enumeration on supabase errors", () => {
  it("returns 200 even when supabase returns an error (no enumeration)", async () => {
    mockState.resetResult = { error: { message: "User not found" } };
    const res = await forgotPasswordPOST(
      makeRequest({ email: "ghost@opollo.com" }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("logs the supabase error at warn level for ops visibility", async () => {
    mockState.resetResult = { error: { message: "Template not found" } };
    await forgotPasswordPOST(
      makeRequest({ email: "hi@opollo.com" }) as never,
    );
    const warn = loggerCalls.warn.find(
      ([msg]) => msg === "forgot_password_supabase_error",
    );
    expect(warn).toBeDefined();
    expect(warn?.[1]?.error).toBe("Template not found");
  });
});
