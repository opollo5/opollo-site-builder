import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract. Cross-tenant identity-leak defence.
//
// Pins the exact request body the identity-resolver sends to
// bundle.social's socialAccountGetByType endpoint, per platform.
// Drift here = silent regression of the identity capture layer; review
// snapshot changes the way you'd review a Zod schema diff at the
// route boundary.
// ---------------------------------------------------------------------------

const socialAccountGetByTypeMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: { socialAccountGetByType: socialAccountGetByTypeMock },
  }),
  getBundlesocialTeamId: () => "ignored-in-this-test",
}));

import {
  computeIdentityHash,
  resolveIdentityFingerprint,
  type BundlesocialPlatformType,
} from "@/lib/platform/social/connections/identity";

const TEAM_ID = "00000000-0000-0000-0000-aaaaaaaa9999";

const PLATFORMS: BundlesocialPlatformType[] = [
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "TWITTER",
  "THREADS",
  "TIKTOK",
  "YOUTUBE",
  "GOOGLE_BUSINESS",
  "PINTEREST",
  "REDDIT",
  "BLUESKY",
  "MASTODON",
  "DISCORD",
  "SLACK",
];

beforeEach(() => {
  socialAccountGetByTypeMock.mockReset();
  socialAccountGetByTypeMock.mockResolvedValue({
    externalId: "stub-external",
    userId: "stub-user",
    userUsername: "stubuser",
    userDisplayName: "Stub User",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CONTRACT: socialAccountGetByType request body — per platform", () => {
  for (const platform of PLATFORMS) {
    it(`[snapshot] ${platform} — request body`, async () => {
      await resolveIdentityFingerprint({
        platform,
        teamId: TEAM_ID,
      });
      const callArg = socialAccountGetByTypeMock.mock.calls[0]?.[0];
      expect(callArg).toMatchSnapshot();
    });
  }
});

describe("resolveIdentityFingerprint — response mapping", () => {
  it("returns nulls when both externalId and userId are null", async () => {
    socialAccountGetByTypeMock.mockResolvedValueOnce({
      externalId: null,
      userId: null,
    });
    const result = await resolveIdentityFingerprint({
      platform: "LINKEDIN",
      teamId: TEAM_ID,
    });
    expect(result.external_account_id).toBeNull();
    expect(result.external_user_id).toBeNull();
    expect(result.external_identity_hash).toBeNull();
  });

  it("computes a hash when at least one identity is populated", async () => {
    socialAccountGetByTypeMock.mockResolvedValueOnce({
      externalId: "urn:li:organization:123",
      userId: "urn:li:person:abc",
    });
    const result = await resolveIdentityFingerprint({
      platform: "LINKEDIN",
      teamId: TEAM_ID,
    });
    expect(result.external_account_id).toBe("urn:li:organization:123");
    expect(result.external_user_id).toBe("urn:li:person:abc");
    expect(result.external_identity_hash).toBe(
      computeIdentityHash("LINKEDIN", "urn:li:organization:123", "urn:li:person:abc"),
    );
  });

  it("returns nulls when the SDK call throws", async () => {
    socialAccountGetByTypeMock.mockRejectedValueOnce(new Error("upstream 500"));
    const result = await resolveIdentityFingerprint({
      platform: "LINKEDIN",
      teamId: TEAM_ID,
    });
    expect(result.external_account_id).toBeNull();
    expect(result.external_user_id).toBeNull();
    expect(result.external_identity_hash).toBeNull();
  });
});
