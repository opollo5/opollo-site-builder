import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R6 — initiate-connect logs request + response payload
//
// Incident: during the bundle.social outage investigation, agents
// jumped to "third-party bug" without seeing the actual outgoing
// request body in production logs. The fix added structured
// logger.info calls at request-out and response-in. This regression
// pins those log lines so they can't silently disappear in a
// refactor.
//
// Pinned invariant: a successful initiateBundlesocialConnect call
// emits both `bundlesocial.initiate_connect.request` and
// `.response` log lines, and the request line contains the
// social_account_types we sent.
// ---------------------------------------------------------------------------

const mockClient = {
  socialAccount: { socialAccountCreatePortalLink: vi.fn() },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-r6",
}));

vi.mock("@/lib/platform/social/bundle-social/provision", () => ({
  getOrCreateBundleSocialTeam: vi.fn().mockResolvedValue("team-r6"),
}));

import { initiateBundlesocialConnect } from "@/lib/platform/social/connections";

beforeEach(() => {
  mockClient.socialAccount.socialAccountCreatePortalLink.mockReset();
  mockClient.socialAccount.socialAccountCreatePortalLink.mockResolvedValue({
    url: "https://bundle.social/portal/r6?token=t",
  });
});
afterEach(() => vi.clearAllMocks());

describe("R6: initiate-connect emits diagnostic log lines", () => {
  it("logs both request and response with the platforms array", async () => {
    const events: Array<{ event: string; meta: Record<string, unknown> }> = [];
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(logger, "info").mockImplementation(((
      event: string,
      meta?: Record<string, unknown>,
    ) => {
      events.push({ event, meta: meta ?? {} });
    }) as never);

    try {
      await initiateBundlesocialConnect({
        companyId: "00000000-0000-0000-0000-000000000001",
        platforms: ["x", "facebook_page"],
        redirectUrl: "https://opollo.test/cb",
      });
    } finally {
      spy.mockRestore();
    }

    const reqLog = events.find(
      (e) => e.event === "bundlesocial.initiate_connect.request",
    );
    const respLog = events.find(
      (e) => e.event === "bundlesocial.initiate_connect.response",
    );
    expect(reqLog).toBeDefined();
    expect(respLog).toBeDefined();
    // The request log MUST include the platforms — the bug under
    // investigation hinged on what we were sending.
    expect(reqLog?.meta.social_account_types).toEqual(
      expect.arrayContaining(["TWITTER", "FACEBOOK"]),
    );
  });
});
