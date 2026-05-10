import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract.
//
// BSP-7: pins the EXACT payload shape we send to bundle.social's
// socialAccountDisconnect endpoint. Same convention as profile-connect:
// mock SDK at the boundary, snapshot requestBody, treat drift as schema
// review.
// ---------------------------------------------------------------------------

const socialAccountDisconnectMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountDisconnect: socialAccountDisconnectMock,
    },
  }),
  getBundlesocialTeamId: () => "ignored-in-this-test",
}));

vi.mock("@/lib/platform/social/profiles/provision-team", () => ({
  getOrCreateBundleSocialTeamForProfile: vi
    .fn()
    .mockResolvedValue("team-contract-bsp7"),
}));

import { disconnectProfileAccount } from "@/lib/platform/social/profiles/connect";

const PROFILE_ID = "abcdef00-0000-0000-0000-aaaaaaaa0150";

beforeEach(() => {
  socialAccountDisconnectMock.mockReset();
  socialAccountDisconnectMock.mockResolvedValue({
    id: "acc-1",
    type: "LINKEDIN",
    teamId: "team-contract-bsp7",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CONTRACT: bundle.social socialAccountDisconnect (BSP-7)", () => {
  it("[snapshot] LinkedIn — minimal request body", async () => {
    await disconnectProfileAccount({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
    });
    const arg = socialAccountDisconnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });

  it("[snapshot] Facebook", async () => {
    await disconnectProfileAccount({
      profileId: PROFILE_ID,
      platform: "FACEBOOK",
    });
    const arg = socialAccountDisconnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });

  it("rejects empty profileId with VALIDATION_FAILED", async () => {
    const result = await disconnectProfileAccount({
      profileId: "",
      platform: "LINKEDIN",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("surfaces SDK error as INTERNAL_ERROR", async () => {
    socialAccountDisconnectMock.mockRejectedValueOnce(new Error("upstream 502"));
    const result = await disconnectProfileAccount({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns RECEIVER_NOT_CONFIGURED if BUNDLE_SOCIAL_API is missing", async () => {
    vi.doMock("@/lib/bundlesocial", () => ({
      getBundlesocialClient: () => null,
      getBundlesocialTeamId: () => null,
    }));
    vi.resetModules();
    const { disconnectProfileAccount: fresh } = await import(
      "@/lib/platform/social/profiles/connect"
    );
    const result = await fresh({ profileId: PROFILE_ID, platform: "LINKEDIN" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RECEIVER_NOT_CONFIGURED");
  });

  it("returns ok:true on success and surfaces team_id + platform", async () => {
    const result = await disconnectProfileAccount({
      profileId: PROFILE_ID,
      platform: "TWITTER",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.teamId).toBe("team-contract-bsp7");
    expect(result.data.platform).toBe("TWITTER");
  });
});
