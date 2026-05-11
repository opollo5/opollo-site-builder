import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract.
//
// BSP-6: pins the EXACT payload shape we send to bundle.social's
// socialAccountConnect when initiating a per-profile direct OAuth flow.
// Same convention as bundle-social.contract.test.ts (BSP hosted-portal):
//   * Mock the SDK at the boundary.
//   * Assert exact requestBody via toMatchSnapshot().
//   * Snapshot drift gets the same scrutiny as a Zod schema change.
// ---------------------------------------------------------------------------

const socialAccountConnectMock = vi.fn();
const teamGetTeamMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountConnect: socialAccountConnectMock,
    },
    team: {
      teamGetTeam: teamGetTeamMock,
    },
  }),
  getBundlesocialTeamId: () => "ignored-in-this-test",
}));

// Stub the team-provision helper so the contract test stays at the
// SDK boundary — racing against teamCreateTeam isn't this layer's job
// (that's covered by profile-provision-team.test.ts).
vi.mock("@/lib/platform/social/profiles/provision-team", () => ({
  getOrCreateBundleSocialTeamForProfile: vi
    .fn()
    .mockResolvedValue("team-contract-bsp6"),
}));

import {
  initiateProfileConnect,
  readProfileTeamAccounts,
} from "@/lib/platform/social/profiles/connect";

const PROFILE_ID = "abcdef00-0000-0000-0000-aaaaaaaa0140";
const REDIRECT_URL =
  "https://opollo-site-builder.vercel.app/api/platform/social/connections/callback?company_id=abcdef00-0000-0000-0000-aaaaaaaa1616&popup=1";

beforeEach(() => {
  socialAccountConnectMock.mockReset();
  teamGetTeamMock.mockReset();
  socialAccountConnectMock.mockResolvedValue({
    url: "https://oauth.example.com/start?state=xyz",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CONTRACT: bundle.social socialAccountConnect (BSP-6)", () => {
  it("[snapshot] LinkedIn — minimal request body", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
      redirectUrl: REDIRECT_URL,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });

  it("[snapshot] Facebook with disableAutoLogin: true", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "FACEBOOK",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: true,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });

  it("[snapshot] disableAutoLogin: false omits the key entirely", async () => {
    // disableAutoLogin should NOT appear in the request body when false —
    // sending false explicitly could change provider behaviour across SDK
    // versions. We elect to omit.
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "TWITTER",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: false,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
    expect(arg?.requestBody).not.toHaveProperty("disableAutoLogin");
  });

  it("[snapshot] Facebook with withBusinessScope: true", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "FACEBOOK",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: true,
      withBusinessScope: true,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
    expect(arg?.requestBody).toHaveProperty("withBusinessScope", true);
  });

  it("[snapshot] withBusinessScope: false omits the key", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
      redirectUrl: REDIRECT_URL,
      withBusinessScope: false,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
    expect(arg?.requestBody).not.toHaveProperty("withBusinessScope");
  });

  it("returns RECEIVER_NOT_CONFIGURED if BUNDLE_SOCIAL_API is missing", async () => {
    vi.doMock("@/lib/bundlesocial", () => ({
      getBundlesocialClient: () => null,
      getBundlesocialTeamId: () => null,
    }));
    vi.resetModules();
    const { initiateProfileConnect: fresh } = await import(
      "@/lib/platform/social/profiles/connect"
    );
    const result = await fresh({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
      redirectUrl: REDIRECT_URL,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RECEIVER_NOT_CONFIGURED");
  });

  it("rejects empty profileId with VALIDATION_FAILED", async () => {
    const result = await initiateProfileConnect({
      profileId: "",
      platform: "LINKEDIN",
      redirectUrl: REDIRECT_URL,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects empty redirectUrl with VALIDATION_FAILED", async () => {
    const result = await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
      redirectUrl: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("readProfileTeamAccounts (BSP-6)", () => {
  it("returns mapped account list when team has accounts", async () => {
    teamGetTeamMock.mockResolvedValueOnce({
      id: "team-x",
      name: "X",
      socialAccounts: [
        {
          id: "acc-1",
          type: "LINKEDIN",
          username: "joe",
          displayName: "Joe Doe",
          teamId: "team-x",
        },
        {
          id: "acc-2",
          type: "TWITTER",
          username: null,
          displayName: null,
          teamId: "team-x",
        },
      ],
    });
    const result = await readProfileTeamAccounts({ teamId: "team-x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.accounts).toEqual([
      { id: "acc-1", type: "LINKEDIN", username: "joe", displayName: "Joe Doe" },
      { id: "acc-2", type: "TWITTER", username: null, displayName: null },
    ]);
  });

  it("surfaces SDK errors as INTERNAL_ERROR", async () => {
    teamGetTeamMock.mockRejectedValueOnce(new Error("upstream 500"));
    const result = await readProfileTeamAccounts({ teamId: "team-x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});
