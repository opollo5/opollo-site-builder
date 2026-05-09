import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract.
//
// Pins the EXACT payload shape we send to bundle.social when initiating
// a connect-portal flow, against frozen reference snapshots. Snapshot
// changes must be reviewed in PRs the way migrations are reviewed.
//
// Why this layer is critical: PR #814's duplicate `LINKEDIN` bug (the
// canary outage) would have failed the dedup snapshot the moment the
// `Set` collapse was removed. The integration layer assertion was
// "no duplicates" — easy to delete. A frozen snapshot of the exact
// outgoing array is a contract; deletions show up as a diff in the PR.
//
// Convention:
//   - File ends in `.contract.test.ts`.
//   - Snapshots live next to the test in `__snapshots__/` (vitest default).
//   - Mock the SDK at the boundary; assert exact args via `toMatchSnapshot()`
//     or hard-coded equality.
//   - Treat snapshot diffs as needing the same scrutiny as a Zod schema
//     change at a route boundary.
// ---------------------------------------------------------------------------

const mockClient = {
  socialAccount: {
    socialAccountCreatePortalLink: vi.fn(),
  },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => "team-contract-snapshot",
}));

import { initiateBundlesocialConnect } from "@/lib/platform/social/connections";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaaaaaa1616";
const REDIRECT_URL =
  "https://opollo-site-builder.vercel.app/api/platform/social/connections/callback?company_id=abcdef00-0000-0000-0000-aaaaaaaa1616";

beforeEach(() => {
  mockClient.socialAccount.socialAccountCreatePortalLink.mockReset();
  mockClient.socialAccount.socialAccountCreatePortalLink.mockResolvedValue({
    url: "https://bundle.social/portal/abc?token=test-session-token",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CONTRACT: bundle.social socialAccountCreatePortalLink", () => {
  it("[snapshot] all platforms — order, dedup, shape are stable", async () => {
    await initiateBundlesocialConnect({
      companyId: COMPANY_ID,
      platforms: [
        "linkedin_personal",
        "linkedin_company",
        "facebook_page",
        "x",
        "gbp",
      ],
      redirectUrl: REDIRECT_URL,
    });

    const arg =
      mockClient.socialAccount.socialAccountCreatePortalLink.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });

  it("[snapshot] empty platforms[] fallback", async () => {
    await initiateBundlesocialConnect({
      companyId: COMPANY_ID,
      platforms: [],
      redirectUrl: REDIRECT_URL,
    });

    const arg =
      mockClient.socialAccount.socialAccountCreatePortalLink.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });

  it("[snapshot] LinkedIn-only (personal+company → single LINKEDIN)", async () => {
    await initiateBundlesocialConnect({
      companyId: COMPANY_ID,
      platforms: ["linkedin_personal", "linkedin_company"],
      redirectUrl: REDIRECT_URL,
    });

    const arg =
      mockClient.socialAccount.socialAccountCreatePortalLink.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });

  // Hard equality on the dedup invariant — independent of snapshot drift.
  it("REGRESSION (R1): socialAccountTypes contains no duplicates, ever", async () => {
    const cases: Array<Parameters<typeof initiateBundlesocialConnect>[0]> = [
      {
        companyId: COMPANY_ID,
        platforms: ["linkedin_personal", "linkedin_company"],
        redirectUrl: REDIRECT_URL,
      },
      {
        companyId: COMPANY_ID,
        platforms: [
          "linkedin_personal",
          "linkedin_company",
          "facebook_page",
          "x",
        ],
        redirectUrl: REDIRECT_URL,
      },
      {
        companyId: COMPANY_ID,
        platforms: [],
        redirectUrl: REDIRECT_URL,
      },
    ];

    for (const c of cases) {
      mockClient.socialAccount.socialAccountCreatePortalLink.mockClear();
      await initiateBundlesocialConnect(c);
      const arg =
        mockClient.socialAccount.socialAccountCreatePortalLink.mock
          .calls[0]?.[0];
      const types: string[] = arg?.requestBody?.socialAccountTypes ?? [];
      expect(types.length).toBe(new Set(types).size);
    }
  });

  it("REGRESSION (R6): emits initiate_connect.{request,response} log lines", async () => {
    const calls: Array<{ event: string; meta: Record<string, unknown> }> = [];
    const { logger } = await import("@/lib/logger");
    const spy = vi.spyOn(logger, "info").mockImplementation(((
      event: string,
      meta?: Record<string, unknown>,
    ) => {
      calls.push({ event, meta: meta ?? {} });
    }) as never);

    try {
      await initiateBundlesocialConnect({
        companyId: COMPANY_ID,
        platforms: ["x"],
        redirectUrl: REDIRECT_URL,
      });
    } finally {
      spy.mockRestore();
    }

    const events = calls.map((c) => c.event);
    expect(events).toContain("bundlesocial.initiate_connect.request");
    expect(events).toContain("bundlesocial.initiate_connect.response");
  });
});
