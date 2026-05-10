import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R2 — tokenless portal URL must be rejected
//
// Incident: PR #816 ("fix(social): block tokenless bundle.social portal
// redirect"), May 2026. bundle.social returned a portal URL like
// `https://bundle.social/connect` (no query string, therefore no
// session token). The pre-fix code redirected the admin to that URL,
// which rendered "There was an error" — a silent failure mode that
// looked like a third-party bug but was actually a config issue
// (redirect domain not whitelisted in bundle.social team settings).
//
// Pinned invariant: when the SDK returns a URL without a query string,
// initiateBundlesocialConnect returns ok:false, INTERNAL_ERROR, with a
// message that mentions "session token" — so a human reading logs can
// trace it back to the whitelist issue.
// ---------------------------------------------------------------------------

const mockClient = {
  socialAccount: { socialAccountCreatePortalLink: vi.fn() },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-r2",
}));

vi.mock("@/lib/platform/social/bundle-social/provision", () => ({
  getOrCreateBundleSocialTeam: vi.fn().mockResolvedValue("team-r2"),
}));

import { initiateBundlesocialConnect } from "@/lib/platform/social/connections";

beforeEach(() => {
  mockClient.socialAccount.socialAccountCreatePortalLink.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("R2: tokenless URL must not be redirected to", () => {
  it.each([
    "https://bundle.social/connect",
    "https://bundle.social/portal",
    "https://bundle.social/",
  ])("rejects %s with INTERNAL_ERROR mentioning session token", async (url) => {
    mockClient.socialAccount.socialAccountCreatePortalLink.mockResolvedValueOnce({
      url,
    });
    const res = await initiateBundlesocialConnect({
      companyId: "00000000-0000-0000-0000-000000000001",
      platforms: ["x"],
      redirectUrl: "https://opollo.test/cb",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("INTERNAL_ERROR");
    expect(res.error.message).toMatch(/session token/i);
  });

  it("accepts a URL with a query string (positive control)", async () => {
    mockClient.socialAccount.socialAccountCreatePortalLink.mockResolvedValueOnce({
      url: "https://bundle.social/portal/abc?token=xyz",
    });
    const res = await initiateBundlesocialConnect({
      companyId: "00000000-0000-0000-0000-000000000001",
      platforms: ["x"],
      redirectUrl: "https://opollo.test/cb",
    });
    expect(res.ok).toBe(true);
  });
});
