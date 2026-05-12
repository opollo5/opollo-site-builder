import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — channels picker endpoint must use socialAccountGetByType
// (cached read), NOT socialAccountRefreshChannels (forces upstream
// refresh, which 500s on bundle.social for LinkedIn).
//
// Incident: docs/incidents/2026-05-12-channel-picker-second-pass.md §B.
//
// Pinned invariant: GET /api/platform/social/connections/[id]/channels
// reads the cached channels list via socialAccountGetByType. The
// upstream refresh endpoint is broken (500 from bundle.social). The
// picker only needs the channels that OAuth populated immediately;
// force-refresh adds nothing.
// ---------------------------------------------------------------------------

const getByTypeMock = vi.fn();
const refreshChannelsMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountGetByType: getByTypeMock,
      socialAccountRefreshChannels: refreshChannelsMock,
    },
  }),
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

const connRow = {
  id: "abcdef00-0000-0000-0000-aaaaaaaa0001",
  company_id: "11111111-1111-1111-1111-111111111111",
  profile_id: "22222222-2222-2222-2222-222222222222",
  platform: "linkedin_personal",
  bundle_social_account_id: "bs-acct-1",
  status: "pending_identity",
  is_personal_mode: false,
};

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_connections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: connRow, error: null }),
            }),
          }),
        };
      }
      if (table === "platform_social_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { bundle_social_team_id: "team-fixture" },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { GET } from "@/app/api/platform/social/connections/[id]/channels/route";

beforeEach(() => {
  getByTypeMock.mockReset();
  refreshChannelsMock.mockReset();
  getByTypeMock.mockResolvedValue({
    externalId: null,
    userId: "urn:li:person:cn_test",
    channels: [
      { id: "urn:li:person:cn_test", name: "Test User", username: "testuser" },
      { id: "urn:li:organization:1234", name: "Test Org", username: "test-org" },
    ],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callGet(): Promise<Response> {
  return GET(
    new Request("http://localhost/x", { method: "GET" }) as never,
    { params: { id: connRow.id } },
  );
}

describe("R-CHANNELS-ENDPOINT: picker must use socialAccountGetByType (not RefreshChannels)", () => {
  it("invokes socialAccountGetByType, NOT socialAccountRefreshChannels", async () => {
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(getByTypeMock).toHaveBeenCalledTimes(1);
    expect(refreshChannelsMock).not.toHaveBeenCalled();
  });

  it("passes teamId and platform type to socialAccountGetByType", async () => {
    await callGet();
    expect(getByTypeMock).toHaveBeenCalledWith({
      teamId: "team-fixture",
      type: "LINKEDIN",
    });
  });

  it("returns the channels in the picker payload shape", async () => {
    const res = await callGet();
    const json = (await res.json()) as {
      ok: boolean;
      data?: { channels: Array<{ id: string; name: string }> };
    };
    expect(json.ok).toBe(true);
    expect(json.data?.channels).toHaveLength(2);
    expect(json.data?.channels[0]?.id).toBe("urn:li:person:cn_test");
    expect(json.data?.channels[1]?.id).toBe("urn:li:organization:1234");
  });

  it("does not call RefreshChannels even when bundle.social would normally 500 on it", async () => {
    // Sanity check: if anyone wires the route back to refreshChannels and
    // that endpoint 500s, this test still fires correctly because the
    // refreshChannels mock is configured to throw.
    refreshChannelsMock.mockRejectedValueOnce(
      Object.assign(new Error("Something went wrong, please try again later."), {
        name: "ApiError",
        status: 500,
      }),
    );
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(refreshChannelsMock).not.toHaveBeenCalled();
  });
});
