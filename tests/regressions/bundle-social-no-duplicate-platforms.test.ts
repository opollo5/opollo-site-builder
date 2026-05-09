import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R1 — bundle.social "duplicate LINKEDIN" outage
//
// Incident: PR #814 (bundle.social social-connections feature), May 2026.
// Behaviour pre-fix: socialAccountTypes contained ["LINKEDIN", "LINKEDIN", ...]
// when the operator selected both linkedin_personal and linkedin_company,
// OR when the empty-platforms[] fallback path fired (Object.values produced
// duplicates because both LinkedIn variants map to LINKEDIN).
//
// bundle.social rejected the duplicate-types payload silently — returning
// a portal URL with no token, which the user saw as "There was an error".
//
// Pinned invariant: socialAccountTypes is always a unique-element array,
// regardless of which input shape produced it.
// ---------------------------------------------------------------------------

const mockClient = {
  socialAccount: {
    socialAccountCreatePortalLink: vi.fn(),
  },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-r1",
}));

import { initiateBundlesocialConnect } from "@/lib/platform/social/connections";

beforeEach(() => {
  mockClient.socialAccount.socialAccountCreatePortalLink.mockReset();
  mockClient.socialAccount.socialAccountCreatePortalLink.mockResolvedValue({
    url: "https://bundle.social/portal/x?token=t",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const inputs = [
  ["linkedin_personal", "linkedin_company"] as const,
  ["linkedin_personal", "linkedin_company", "x"] as const,
  ["linkedin_personal", "linkedin_company", "facebook_page", "x", "gbp"] as const,
  [] as const, // fallback path — Object.values would otherwise produce duplicates
];

describe.each(inputs)("R1: socialAccountTypes is unique (input: %j)", (...platforms) => {
  it("contains no duplicates", async () => {
    await initiateBundlesocialConnect({
      companyId: "00000000-0000-0000-0000-000000000001",
      platforms: [...platforms] as Array<
        "linkedin_personal" | "linkedin_company" | "facebook_page" | "x" | "gbp"
      >,
      redirectUrl: "https://opollo.test/cb",
    });

    const arg =
      mockClient.socialAccount.socialAccountCreatePortalLink.mock.calls[0]?.[0];
    const types: string[] = arg?.requestBody?.socialAccountTypes ?? [];
    expect(types.length).toBeGreaterThan(0);
    expect(types.length).toBe(new Set(types).size);
  });
});
