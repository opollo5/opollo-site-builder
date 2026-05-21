import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Regression: /api/auth/callback signs out any existing session BEFORE
// exchanging the incoming code (Bug 1 — "expired link" + wrong user).
//
// Root cause: without signOut() before exchangeCodeForSession / verifyOtp,
// a previously signed-in user's cookies stay in play during the exchange.
// The code is consumed (one-use) but the session lands with the old user's
// identity. Subsequent attempts get "expired link" because the code was
// already spent. The wrong user's name is also displayed because the old
// session persists.
//
// Working analog: loginAction (app/login/actions.ts) calls signOut() on the
// 2FA rate-limit path as the canonical "clear state before auth change"
// pattern. The fix makes the callback route follow the same pattern.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  exchangeResult: { error: null as { message: string } | null },
  exchangeCalls: [] as Array<string>,
  verifyResult: { error: null as { message: string } | null },
  verifyCalls: [] as Array<{ type: string; token_hash: string }>,
  signOutCalls: [] as Array<"before_exchange" | "before_verify">,
  callOrder: [] as Array<"signOut" | "exchange" | "verify">,
  rateLimitOk: true,
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: () => ({
    auth: {
      signOut: async () => {
        mockState.signOutCalls.push("before_exchange");
        mockState.callOrder.push("signOut");
        return { error: null };
      },
      exchangeCodeForSession: async (code: string) => {
        mockState.exchangeCalls.push(code);
        mockState.callOrder.push("exchange");
        return mockState.exchangeResult;
      },
      verifyOtp: async (params: { type: string; token_hash: string }) => {
        mockState.verifyCalls.push(params);
        mockState.callOrder.push("verify");
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
  mockState.signOutCalls = [];
  mockState.callOrder = [];
  mockState.rateLimitOk = true;
});

function makeReq(query: string): NextRequest {
  return new NextRequest(`https://opollo.vercel.app/api/auth/callback${query}`);
}

describe("Regression: auth callback signs out before exchange (Bug 1 — expired link + wrong user)", () => {
  it("calls signOut BEFORE exchangeCodeForSession on the PKCE path", async () => {
    const res = await callbackGET(makeReq("?code=pkce-test"));
    expect(res.status).toBe(307);
    // signOut must precede exchange
    expect(mockState.callOrder).toEqual(["signOut", "exchange"]);
    expect(mockState.signOutCalls).toHaveLength(1);
    expect(mockState.exchangeCalls).toEqual(["pkce-test"]);
  });

  it("calls signOut BEFORE verifyOtp on the OTP path", async () => {
    const res = await callbackGET(makeReq("?token_hash=h-otp&type=recovery"));
    expect(res.status).toBe(307);
    // signOut must precede verify
    expect(mockState.callOrder).toEqual(["signOut", "verify"]);
    expect(mockState.signOutCalls).toHaveLength(1);
    expect(mockState.verifyCalls).toEqual([
      { type: "recovery", token_hash: "h-otp" },
    ]);
  });

  it("does NOT call signOut when no code/token_hash is present (early-exit path)", async () => {
    const res = await callbackGET(makeReq(""));
    // missing_code redirect fires before supabase is initialised
    expect(mockState.signOutCalls).toHaveLength(0);
    expect(mockState.callOrder).toEqual([]);
    const loc = res.headers.get("location");
    expect(loc).toContain("/auth-error");
  });
});
