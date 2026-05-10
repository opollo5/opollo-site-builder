import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract.
//
// BSP-9: pins that when the customer-facing connect API receives a
// profile_id in the body, initiateBundlesocialConnect routes the
// hosted-portal request to the PROFILE's bundle.social team (via
// getOrCreateBundleSocialTeamForProfile) instead of the company-level
// team (via getOrCreateBundleSocialTeam).
//
// Why this layer: the connect flow has a critical wire-format invariant
// — the teamId on the bundle.social request must match the team that
// will receive the OAuth-completed account. If profileId support routes
// to the wrong team, accounts land on the wrong team and the next sync
// attributes them to the wrong profile. Snapshot pins the requestBody.
// ---------------------------------------------------------------------------

const portalMock = vi.fn();
const provisionCompanyMock = vi.fn();
const provisionProfileMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: { socialAccountCreatePortalLink: portalMock },
  }),
  getBundlesocialTeamId: () => "ignored-in-this-test",
}));

vi.mock("@/lib/platform/social/bundle-social/provision", () => ({
  getOrCreateBundleSocialTeam: (...args: unknown[]) =>
    provisionCompanyMock(...args),
}));

vi.mock("@/lib/platform/social/profiles/provision-team", () => ({
  getOrCreateBundleSocialTeamForProfile: (...args: unknown[]) =>
    provisionProfileMock(...args),
}));

import { initiateBundlesocialConnect } from "@/lib/platform/social/connections";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaaaaaa1616";
const PROFILE_ID = "abcdef00-0000-0000-0000-aaaaaaaa0190";
const REDIRECT_URL =
  "https://opollo-site-builder.vercel.app/api/platform/social/connections/callback?company_id=abcdef00-0000-0000-0000-aaaaaaaa1616";

beforeEach(() => {
  portalMock.mockReset();
  provisionCompanyMock.mockReset();
  provisionProfileMock.mockReset();
  portalMock.mockResolvedValue({
    url: "https://bundle.social/portal/abc?token=test-session-token",
  });
  provisionCompanyMock.mockResolvedValue("team-company-level");
  provisionProfileMock.mockResolvedValue("team-profile-scoped");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CONTRACT: customer connect with profile_id (BSP-9)", () => {
  it("REGRESSION: profileId routes the portal request to the profile's team", async () => {
    await initiateBundlesocialConnect({
      companyId: COMPANY_ID,
      profileId: PROFILE_ID,
      platforms: ["x"],
      redirectUrl: REDIRECT_URL,
    });

    // Profile-scoped provision must have been called, not company-level.
    expect(provisionProfileMock).toHaveBeenCalledTimes(1);
    expect(provisionProfileMock).toHaveBeenCalledWith(PROFILE_ID);
    expect(provisionCompanyMock).not.toHaveBeenCalled();

    const arg = portalMock.mock.calls[0]?.[0];
    expect(arg?.requestBody?.teamId).toBe("team-profile-scoped");
  });

  it("REGRESSION: omitted profileId falls back to company-level team", async () => {
    await initiateBundlesocialConnect({
      companyId: COMPANY_ID,
      platforms: ["x"],
      redirectUrl: REDIRECT_URL,
    });

    // Company-level provision must have been called, not profile-scoped.
    expect(provisionCompanyMock).toHaveBeenCalledTimes(1);
    expect(provisionCompanyMock).toHaveBeenCalledWith(COMPANY_ID);
    expect(provisionProfileMock).not.toHaveBeenCalled();

    const arg = portalMock.mock.calls[0]?.[0];
    expect(arg?.requestBody?.teamId).toBe("team-company-level");
  });

  it("[snapshot] profile-scoped portal request body", async () => {
    await initiateBundlesocialConnect({
      companyId: COMPANY_ID,
      profileId: PROFILE_ID,
      platforms: ["linkedin_personal"],
      redirectUrl: REDIRECT_URL,
      logoUrl: "https://cdn.example.com/logo.png",
      userName: "Acme Corp",
      language: "en",
    });
    const arg = portalMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });
});
