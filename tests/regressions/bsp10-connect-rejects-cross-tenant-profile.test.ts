import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// SECURITY — BSP-10: cross-tenant profile_id smuggling guard
//
// Invariant: POST /api/platform/social/connections/connect must reject
// requests where `profile_id` belongs to a different company than
// `company_id`, even when the caller is an authenticated admin of
// `company_id`.
//
// Without this check, an admin of company A could pass a profile_id from
// company B and initiate OAuth against B's bundle.social team, attributing
// the resulting connection to a company they don't control.
//
// Layer 1 / Layer 6 — unit, mocked dependencies. No real Supabase needed.
// ---------------------------------------------------------------------------

const COMPANY_A = "aaaaaaaa-0000-0000-0000-000000000001";
const COMPANY_B = "bbbbbbbb-0000-0000-0000-000000000001";
const PROFILE_A = "aaaaaaaa-0000-0000-0000-000000000002";
const PROFILE_B = "bbbbbbbb-0000-0000-0000-000000000002";

const warnCalls: Array<{ event: string; payload: Record<string, unknown> }> = [];
const initiateCalls: Array<{ profileId: string }> = [];

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: (event: string, payload: Record<string, unknown>) => {
      warnCalls.push({ event, payload });
    },
    error: vi.fn(),
  },
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({ kind: "allow" as const, userId: "user-a" }),
}));

const profileStore: Record<string, { id: string; company_id: string }> = {
  [PROFILE_A]: { id: PROFILE_A, company_id: COMPANY_A },
  [PROFILE_B]: { id: PROFILE_B, company_id: COMPANY_B },
};

vi.mock("@/lib/platform/social/profiles", () => ({
  getProfileById: async (id: string) => profileStore[id] ?? null,
}));

vi.mock("@/lib/platform/social/profiles/connect", () => ({
  initiateProfileConnect: async (input: { profileId: string }) => {
    initiateCalls.push({ profileId: input.profileId });
    return { ok: true, data: { url: "https://oauth.example.com/go", teamId: "team-x" } };
  },
}));

import { POST } from "@/app/api/platform/social/connections/connect/route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/platform/social/connections/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  warnCalls.length = 0;
  initiateCalls.length = 0;
});

afterEach(() => vi.clearAllMocks());

describe("BSP-10 SECURITY: connect route rejects cross-tenant profile_id", () => {
  it("allows when profile_id belongs to the same company", async () => {
    const res = await POST(makeRequest({
      company_id: COMPANY_A,
      profile_id: PROFILE_A,
      platform: "LINKEDIN",
    }) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    expect(initiateCalls).toHaveLength(1);
  });

  it("returns 404 when profile_id belongs to a different company", async () => {
    const res = await POST(makeRequest({
      company_id: COMPANY_A,
      profile_id: PROFILE_B,
      platform: "LINKEDIN",
    }) as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean; error?: { code: string } };
    expect(json.ok).toBe(false);
  });

  it("does not call initiateProfileConnect on a smuggling attempt", async () => {
    await POST(makeRequest({
      company_id: COMPANY_A,
      profile_id: PROFILE_B,
      platform: "FACEBOOK",
    }) as never);
    expect(initiateCalls).toHaveLength(0);
  });

  it("emits a warning log on a smuggling attempt", async () => {
    await POST(makeRequest({
      company_id: COMPANY_A,
      profile_id: PROFILE_B,
      platform: "LINKEDIN",
    }) as never);
    const hit = warnCalls.find(
      (c) => c.event === "social.connections.connect.profile_smuggling_attempt",
    );
    expect(hit).toBeDefined();
    expect(hit?.payload.companyId).toBe(COMPANY_A);
    expect(hit?.payload.profileId).toBe(PROFILE_B);
    expect(hit?.payload.profileCompanyId).toBe(COMPANY_B);
  });

  it("returns 404 when profile_id is unknown", async () => {
    const res = await POST(makeRequest({
      company_id: COMPANY_A,
      profile_id: "00000000-0000-0000-0000-000000000099",
      platform: "LINKEDIN",
    }) as never);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
    expect(initiateCalls).toHaveLength(0);
  });
});
