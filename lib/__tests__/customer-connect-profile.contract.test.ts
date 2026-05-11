import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract.
//
// BSP-6-CUSTOMER: pins the exact SDK payload the customer-facing connect
// route produces when a user connects via the platform-picker lightbox.
//
// The route calls initiateProfileConnect (direct OAuth, not portal link)
// with:
//   disableAutoLogin: true  — always, to avoid silent re-auth of an
//                             existing session on FB/IG/TikTok.
//   withBusinessScope: true — for FACEBOOK and INSTAGRAM only, to request
//                             business_management / ads_management scopes.
//
// This contract pins those flags so a route refactor cannot silently drop
// them — snapshot drift gets the same scrutiny as a Zod schema change.
// ---------------------------------------------------------------------------

const socialAccountConnectMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountConnect: socialAccountConnectMock,
    },
  }),
  getBundlesocialTeamId: () => "ignored-in-this-test",
}));

vi.mock("@/lib/platform/social/profiles/provision-team", () => ({
  getOrCreateBundleSocialTeamForProfile: vi
    .fn()
    .mockResolvedValue("team-customer-contract"),
}));

import { initiateProfileConnect } from "@/lib/platform/social/profiles/connect";

const PROFILE_ID = "abcdef00-0000-0000-0000-aaaaaaaa0191";
const REDIRECT_URL =
  "https://opollo-site-builder.vercel.app/api/platform/social/connections/callback?company_id=abcdef00-0000-0000-0000-aaaaaaaa1616&popup=1";

beforeEach(() => {
  socialAccountConnectMock.mockReset();
  socialAccountConnectMock.mockResolvedValue({
    url: "https://oauth.example.com/start?state=xyz",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CONTRACT: customer connect direct OAuth flags (BSP-6-CUSTOMER)", () => {
  it("[snapshot] LINKEDIN — disableAutoLogin:true, no withBusinessScope", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: true,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
    expect(arg?.requestBody).toHaveProperty("disableAutoLogin", true);
    expect(arg?.requestBody).not.toHaveProperty("withBusinessScope");
  });

  it("[snapshot] FACEBOOK — disableAutoLogin:true + withBusinessScope:true", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "FACEBOOK",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: true,
      withBusinessScope: true,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
    expect(arg?.requestBody).toHaveProperty("disableAutoLogin", true);
    expect(arg?.requestBody).toHaveProperty("withBusinessScope", true);
  });

  it("[snapshot] INSTAGRAM — disableAutoLogin:true + withBusinessScope:true", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "INSTAGRAM",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: true,
      withBusinessScope: true,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
    expect(arg?.requestBody).toHaveProperty("disableAutoLogin", true);
    expect(arg?.requestBody).toHaveProperty("withBusinessScope", true);
  });

  it("[snapshot] GOOGLE_BUSINESS — disableAutoLogin:true, no withBusinessScope", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "GOOGLE_BUSINESS",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: true,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
    expect(arg?.requestBody).toHaveProperty("disableAutoLogin", true);
    expect(arg?.requestBody).not.toHaveProperty("withBusinessScope");
  });

  it("REGRESSION: profile-scoped team is used, not company-level team", async () => {
    await initiateProfileConnect({
      profileId: PROFILE_ID,
      platform: "LINKEDIN",
      redirectUrl: REDIRECT_URL,
      disableAutoLogin: true,
    });
    const arg = socialAccountConnectMock.mock.calls[0]?.[0];
    expect(arg?.requestBody?.teamId).toBe("team-customer-contract");
  });
});
