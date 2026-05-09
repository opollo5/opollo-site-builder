import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R7 — env var names are stable
//
// Incident: bundle.social uses TEAMID (no underscore) while every
// other Vercel-provisioned env var in this project uses snake_case
// like `_TEAM_ID`. The pre-fix code looked up `BUNDLE_SOCIAL_TEAM_ID`,
// which was `undefined`, so `getBundlesocialTeamId()` returned null
// silently and the create-portal-link call shipped without a team id —
// resulting in a tokenless URL.
//
// Pinned invariant: the lib reads the EXACTLY-spelled env var names
// `BUNDLE_SOCIAL_API`, `BUNDLE_SOCIAL_TEAMID`,
// `BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET`. A typo in any of these
// fires this test.
//
// Why pinned at the unit layer: a daily drift detector covers the
// "are they SET in production" question. This test covers the
// "is the code looking for the right names" question — orthogonal.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("R7: bundle.social env var names are pinned", () => {
  const src = readFileSync(
    join(process.cwd(), "lib", "bundlesocial.ts"),
    "utf8",
  );

  it("reads BUNDLE_SOCIAL_API (no _KEY suffix, no _APIKEY)", () => {
    expect(src).toMatch(/process\.env\.BUNDLE_SOCIAL_API\b/);
    expect(src).not.toMatch(/process\.env\.BUNDLE_SOCIAL_API_KEY/);
    expect(src).not.toMatch(/process\.env\.BUNDLE_SOCIAL_APIKEY/);
  });

  it("reads BUNDLE_SOCIAL_TEAMID (no underscore — matches Vercel env)", () => {
    expect(src).toMatch(/process\.env\.BUNDLE_SOCIAL_TEAMID\b/);
    expect(src).not.toMatch(/process\.env\.BUNDLE_SOCIAL_TEAM_ID/);
  });

  it("reads BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET (single word, no separator before WEBHOOK)", () => {
    expect(src).toMatch(/BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET/);
    expect(src).not.toMatch(/BUNDLE_SOCIAL_WEBHOOK_SIGNING_SECRET/);
  });
});
