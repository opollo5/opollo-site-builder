import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// /api/auth/callback — fix: handle both PKCE (?code=) and OTP
// (?token_hash=&type=) link shapes.
//
// The default Supabase password-reset / invite email templates use the
// OTP shape (`{{ .TokenHash }}` + `&type=recovery`); only projects on
// the PKCE flow emit `?code=...`. Pre-fix, the callback only handled
// PKCE, so every recovery click on the OTP shape landed on
// /auth-error?reason=missing_code with no path forward. This test
// matrix locks both happy paths plus the existing failure modes.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  exchangeResult: { error: null as { message: string } | null },
  exchangeCalls: [] as Array<string>,
  verifyResult: { error: null as { message: string } | null },
  verifyCalls: [] as Array<{ type: string; token_hash: string }>,
  rateLimitOk: true,
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: () => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        mockState.exchangeCalls.push(code);
        return mockState.exchangeResult;
      },
      verifyOtp: async (params: { type: string; token_hash: string }) => {
        mockState.verifyCalls.push(params);
        return mockState.verifyResult;
      },
    },
  }),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () =>
    mockState.rateLimitOk
      ? { ok: true, limit: 60, remaining: 59, reset: 0 }
      : {
          ok: false,
          limit: 60,
          remaining: 0,
          reset: Date.now() + 60_000,
          retryAfterSec: 60,
        },
  rateLimitExceeded: () =>
    new Response(
      JSON.stringify({ ok: false, error: { code: "RATE_LIMITED" } }),
      { status: 429, headers: { "content-type": "application/json" } },
    ),
  getClientIp: () => "127.0.0.1",
}));

import { GET as callbackGET } from "@/app/api/auth/callback/route";

beforeEach(() => {
  mockState.exchangeResult = { error: null };
  mockState.exchangeCalls = [];
  mockState.verifyResult = { error: null };
  mockState.verifyCalls = [];
  mockState.rateLimitOk = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeReq(query: string): NextRequest {
  return new NextRequest(`https://opollo.vercel.app/api/auth/callback${query}`);
}

function locationOf(res: Response): URL {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("response carries no location header");
  return new URL(loc);
}

describe("GET /api/auth/callback: PKCE (?code=) shape", () => {
  it("calls exchangeCodeForSession and redirects to /admin/sites by default", async () => {
    const res = await callbackGET(makeReq("?code=abc-pkce"));
    expect(res.status).toBe(307);
    expect(mockState.exchangeCalls).toEqual(["abc-pkce"]);
    expect(mockState.verifyCalls).toEqual([]);
    expect(locationOf(res).pathname).toBe("/admin/sites");
  });

  it("honours a same-origin ?next=", async () => {
    const res = await callbackGET(
      makeReq("?code=abc&next=%2Fauth%2Freset-password"),
    );
    expect(locationOf(res).pathname).toBe("/auth/reset-password");
  });

  it("redirects to /auth-error?reason=exchange_failed when exchange errors", async () => {
    mockState.exchangeResult = { error: { message: "invalid grant" } };
    const res = await callbackGET(makeReq("?code=garbage"));
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth-error");
    expect(loc.searchParams.get("reason")).toBe("exchange_failed");
  });
});

describe("GET /api/auth/callback: OTP (?token_hash=&type=) shape", () => {
  it("calls verifyOtp for type=recovery and lands on the next path", async () => {
    const res = await callbackGET(
      makeReq(
        "?token_hash=hash-recovery&type=recovery&next=%2Fauth%2Freset-password",
      ),
    );
    expect(res.status).toBe(307);
    expect(mockState.verifyCalls).toEqual([
      { type: "recovery", token_hash: "hash-recovery" },
    ]);
    expect(mockState.exchangeCalls).toEqual([]);
    expect(locationOf(res).pathname).toBe("/auth/reset-password");
  });

  it("supports type=invite, type=signup, type=magiclink, type=email_change, type=email", async () => {
    for (const type of [
      "invite",
      "signup",
      "magiclink",
      "email_change",
      "email",
    ]) {
      mockState.verifyCalls = [];
      const res = await callbackGET(
        makeReq(`?token_hash=h-${type}&type=${type}`),
      );
      expect(res.status).toBe(307);
      expect(mockState.verifyCalls).toEqual([
        { type, token_hash: `h-${type}` },
      ]);
    }
  });

  it("redirects to /auth-error?reason=invalid_type when type is unknown", async () => {
    const res = await callbackGET(
      makeReq("?token_hash=h&type=not-a-real-type"),
    );
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth-error");
    expect(loc.searchParams.get("reason")).toBe("invalid_type");
    expect(mockState.verifyCalls).toEqual([]);
  });

  it("redirects to /auth-error?reason=invalid_type when type is missing", async () => {
    const res = await callbackGET(makeReq("?token_hash=h"));
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth-error");
    expect(loc.searchParams.get("reason")).toBe("invalid_type");
  });

  it("redirects to /auth-error?reason=verify_failed when verifyOtp errors", async () => {
    mockState.verifyResult = { error: { message: "expired" } };
    const res = await callbackGET(
      makeReq("?token_hash=expired&type=recovery"),
    );
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth-error");
    expect(loc.searchParams.get("reason")).toBe("verify_failed");
  });
});

describe("GET /api/auth/callback: missing token shape", () => {
  it("redirects to /auth-error?reason=missing_code when neither code nor token_hash is present", async () => {
    const res = await callbackGET(makeReq(""));
    const loc = locationOf(res);
    expect(loc.pathname).toBe("/auth-error");
    expect(loc.searchParams.get("reason")).toBe("missing_code");
    expect(mockState.exchangeCalls).toEqual([]);
    expect(mockState.verifyCalls).toEqual([]);
  });
});

describe("GET /api/auth/callback: open-redirect guards on ?next=", () => {
  it("ignores absolute ?next= URLs", async () => {
    const res = await callbackGET(
      makeReq("?code=ok&next=https%3A%2F%2Fevil.example%2Fphish"),
    );
    expect(locationOf(res).pathname).toBe("/admin/sites");
  });

  it("ignores protocol-relative ?next= (//evil)", async () => {
    const res = await callbackGET(makeReq("?code=ok&next=%2F%2Fevil.example"));
    expect(locationOf(res).pathname).toBe("/admin/sites");
  });
});

describe("GET /api/auth/callback: rate limit", () => {
  it("returns 429 when the limiter denies, before any supabase call", async () => {
    mockState.rateLimitOk = false;
    const res = await callbackGET(makeReq("?code=ok"));
    expect(res.status).toBe(429);
    expect(mockState.exchangeCalls).toEqual([]);
    expect(mockState.verifyCalls).toEqual([]);
  });
});
