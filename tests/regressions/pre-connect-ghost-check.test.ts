import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — L1 pre-connect ghost check (POST /connect).
//
// Three scenarios:
//   1. clean: no BS account for (team, platform) → proceed to OAuth as today.
//   2. ghost: BS has account but no DB row matches → auto-disconnect ghost,
//      then proceed to OAuth.
//   3. db_match: BS has account AND a matching DB row → 409 ALREADY_CONNECTED
//      with existing_connection_id, do NOT generate an OAuth URL.
// ---------------------------------------------------------------------------

const getByTypeSdkMock = vi.fn();
const disconnectSdkMock = vi.fn();
const connectSdkMock = vi.fn();
const insertEventMock = vi.fn(async () => ({ error: null }));
const maybeSingleMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountGetByType: getByTypeSdkMock,
      socialAccountDisconnect: disconnectSdkMock,
      socialAccountConnect: connectSdkMock,
    },
  }),
  getBundlesocialTeamId: () => "team-fixture",
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

vi.mock("@/lib/platform/social/profiles", () => ({
  getProfileById: async (id: string) => ({
    id,
    company_id: "11111111-1111-1111-1111-111111111111",
    bundle_social_team_id: "team-fixture",
  }),
}));

vi.mock("@/lib/platform/social/profiles/provision-team", () => ({
  getOrCreateBundleSocialTeamForProfile: async () => "team-fixture",
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_connections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: maybeSingleMock,
            }),
          }),
        };
      }
      if (table === "platform_events") {
        return { insert: insertEventMock };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/platform/social/connections/connect/route";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const PROFILE_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  getByTypeSdkMock.mockReset();
  disconnectSdkMock.mockReset();
  connectSdkMock.mockReset();
  maybeSingleMock.mockReset();
  insertEventMock.mockClear();
  // Default: BS returns no account.
  getByTypeSdkMock.mockResolvedValue(null);
  // Default: DB lookup returns no match.
  maybeSingleMock.mockResolvedValue({ data: null, error: null });
  // Default: connect SDK returns a URL.
  connectSdkMock.mockResolvedValue({
    url: "https://www.facebook.com/oauth?stub",
  });
  // Default: disconnect succeeds.
  disconnectSdkMock.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callConnect(platform: string): Promise<Response> {
  return POST(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: COMPANY_ID,
        profile_id: PROFILE_ID,
        platform,
      }),
    }) as never,
  );
}

describe("R-PRE-CONNECT-GHOST: L1 ghost auto-clear before OAuth", () => {
  it("CLEAN: no BS account → no ghost disconnect, OAuth URL returned", async () => {
    const res = await callConnect("LINKEDIN");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { url: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.url).toContain("oauth");
    expect(disconnectSdkMock).not.toHaveBeenCalled();
    expect(connectSdkMock).toHaveBeenCalledTimes(1);
  });

  it("GHOST: BS has account, DB has no matching row → auto-disconnect, then OAuth", async () => {
    getByTypeSdkMock.mockResolvedValue({
      id: "ghost-bs-acct-1",
      externalId: "urn:li:org:42",
      displayName: "Ghost Co",
    });
    // DB lookup by bundle_social_account_id returns no row.
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const res = await callConnect("LINKEDIN");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { url: string };
    };
    expect(body.ok).toBe(true);
    expect(body.data?.url).toContain("oauth");
    // The ghost MUST be disconnected before OAuth.
    expect(disconnectSdkMock).toHaveBeenCalledWith({
      requestBody: { type: "LINKEDIN", teamId: "team-fixture" },
    });
    expect(connectSdkMock).toHaveBeenCalledTimes(1);
  });

  it("DB_MATCH: BS has account AND DB row matches → 409 ALREADY_CONNECTED, no OAuth", async () => {
    getByTypeSdkMock.mockResolvedValue({
      id: "bs-acct-existing",
      externalId: "urn:li:person:42",
      displayName: "Existing User",
    });
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "11111111-1111-1111-1111-cccccccccccc",
        company_id: COMPANY_ID,
        display_name: "Existing User",
        status: "healthy",
      },
      error: null,
    });

    const res = await callConnect("LINKEDIN");
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      ok: boolean;
      error: {
        code: string;
        existing_connection_id?: string;
        existing_display_name?: string;
      };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ALREADY_CONNECTED");
    expect(body.error.existing_connection_id).toBe(
      "11111111-1111-1111-1111-cccccccccccc",
    );
    expect(body.error.existing_display_name).toBe("Existing User");
    // No ghost disconnect, no OAuth URL generation.
    expect(disconnectSdkMock).not.toHaveBeenCalled();
    expect(connectSdkMock).not.toHaveBeenCalled();
  });

  it("PRE-CHECK ERROR: BS getByType throws non-404 → defensive proceed (OAuth still attempted)", async () => {
    getByTypeSdkMock.mockRejectedValue(
      Object.assign(new Error("upstream 502"), { status: 502 }),
    );
    const res = await callConnect("LINKEDIN");
    // The route ignores the pre-check error and proceeds.
    expect(res.status).toBe(200);
    expect(connectSdkMock).toHaveBeenCalledTimes(1);
  });
});
