import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R4 — bundle.social webhook URL drift
//
// Incident: bundle.social's dashboard had the webhook URL set to
// `https://opollo.vercel.app/api/webhooks/bundlesocial` while the
// active production deployment was at
// `opollo-site-builder.vercel.app`. Webhook events were being
// delivered to a stale domain, silently. Investigation took multiple
// days because the server-side stack was healthy and the failure
// looked like a third-party-bug.
//
// Pinned invariant: the production webhook URL we expect bundle.social
// to deliver to is encoded as a constant. The DAILY config-drift
// detector (.github/workflows/config-drift.yml — wired in Phase E)
// fetches the registered URL from bundle.social's API and compares
// against this constant. This unit-level test pins the constant so a
// rename of the Vercel project must update it explicitly — surfacing
// the change in the PR diff.
// ---------------------------------------------------------------------------

import {
  PRODUCTION_DOMAIN,
  EXPECTED_BUNDLESOCIAL_WEBHOOK_URL,
} from "@/lib/config/production-urls";

describe("R4: bundle.social webhook URL constant is pinned", () => {
  it("PRODUCTION_DOMAIN is the canonical Vercel project domain", () => {
    expect(PRODUCTION_DOMAIN).toBe("https://opollo-site-builder.vercel.app");
    // Defensive: catch the historic typo'd domain that caused the outage.
    expect(PRODUCTION_DOMAIN).not.toBe("https://opollo.vercel.app");
  });

  it("EXPECTED_BUNDLESOCIAL_WEBHOOK_URL points at the production domain + the canonical path", () => {
    expect(EXPECTED_BUNDLESOCIAL_WEBHOOK_URL).toBe(
      "https://opollo-site-builder.vercel.app/api/webhooks/bundlesocial",
    );
  });
});
