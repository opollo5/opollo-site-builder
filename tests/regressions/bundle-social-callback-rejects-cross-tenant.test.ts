import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION (callback cross-tenant trust)
//
// Incident class: the bundle.social callback at
// /api/platform/social/connections/callback?company_id=X uses the
// query parameter as the company-attribution authority. The
// SECURITY assertion is that the route's auth gate rejects when
// the authenticated user is NOT permitted to act on company_id.
//
// We can't drive the full canDo() through here without Supabase, so
// this test mocks the gate and asserts the callback route invokes
// it BEFORE doing any cross-company side effect. The corresponding
// integration test under lib/__tests__/ exercises the full canDo
// path with a real DB.
//
// Pinned invariant: requireCanDoForApi is awaited with the EXACT
// company_id from the query string (not a substring, not a default,
// not an env-derived default).
// ---------------------------------------------------------------------------

const gateCalls: Array<{ companyId: string; action: string }> = [];

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async (companyId: string, action: string) => {
    gateCalls.push({ companyId, action });
    // Simulate deny so we don't run further side effects.
    return {
      kind: "deny" as const,
      response: new Response(JSON.stringify({ ok: false, error: { code: "FORBIDDEN" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    };
  },
}));

vi.mock("@/lib/platform/social/connections", () => ({
  syncBundlesocialConnections: vi.fn(),
}));

import { GET } from "@/app/api/platform/social/connections/callback/route";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  gateCalls.length = 0;
});

afterEach(() => vi.clearAllMocks());

describe("R-CALLBACK: company_id query param is gated, not trusted", () => {
  it("requireCanDoForApi is called with the EXACT query company_id", async () => {
    const url = `http://localhost/api/platform/social/connections/callback?company_id=${COMPANY_A}`;
    const req = new Request(url, { method: "GET" });
    await GET(req as never);
    expect(gateCalls).toEqual([
      { companyId: COMPANY_A, action: "manage_connections" },
    ]);
  });

  it("a different company_id is gated under THAT id (not the prior request's)", async () => {
    await GET(
      new Request(
        `http://localhost/api/platform/social/connections/callback?company_id=${COMPANY_A}`,
        { method: "GET" },
      ) as never,
    );
    await GET(
      new Request(
        `http://localhost/api/platform/social/connections/callback?company_id=${COMPANY_B}`,
        { method: "GET" },
      ) as never,
    );
    expect(gateCalls).toEqual([
      { companyId: COMPANY_A, action: "manage_connections" },
      { companyId: COMPANY_B, action: "manage_connections" },
    ]);
  });

  it("gate-deny short-circuits the redirect flow with the deny response", async () => {
    const req = new Request(
      `http://localhost/api/platform/social/connections/callback?company_id=${COMPANY_A}`,
      { method: "GET" },
    );
    const res = await GET(req as never);
    expect(res.status).toBe(403);
    const json = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(json.ok).toBe(false);
    expect(json.error?.code).toBe("FORBIDDEN");
  });

  it("malformed company_id (not a UUID) short-circuits to error redirect", async () => {
    const req = new Request(
      "http://localhost/api/platform/social/connections/callback?company_id=not-a-uuid",
      { method: "GET" },
    );
    const res = await GET(req as never);
    // Route is documented to redirect on malformed id rather than expose 401.
    expect(res.status).toBe(307);
    // gate must NOT have been called — bad input is rejected before auth.
    expect(gateCalls.length).toBe(0);
  });

  it("missing company_id short-circuits to error redirect", async () => {
    const req = new Request(
      "http://localhost/api/platform/social/connections/callback",
      { method: "GET" },
    );
    const res = await GET(req as never);
    expect(res.status).toBe(307);
    expect(gateCalls.length).toBe(0);
  });
});
