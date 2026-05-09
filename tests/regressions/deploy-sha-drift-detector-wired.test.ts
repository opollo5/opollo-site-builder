import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// REGRESSION R8 — production deploy SHA must match main HEAD post-merge
//
// Incident: during the May 2026 bundle.social outage, the deployed
// bundle did not match source for two rounds. Agents diagnosed
// against local source while the live deploy ran older code. The
// `vercel inspect` step (now item 2 of the live diagnostic protocol)
// makes this catchable mid-incident; this regression keeps it
// catchable PROACTIVELY via the daily drift detector.
//
// Pinned invariant: scripts/drift-check.ts and the matching workflow
// .github/workflows/config-drift.yml both exist and reference the
// expected production URL constant. A future refactor that strips
// the drift check out fires this test.
//
// Future enhancement (out of scope here): the actual deploy-SHA-vs-main
// comparison needs `VERCEL_TOKEN` provisioned to call Vercel's API.
// Until that secret lands, the workflow runs the drift script which
// performs the OTHER drift checks. Once the secret is in place, the
// drift script gains the SHA comparison.
// ---------------------------------------------------------------------------

describe("R8: deploy-SHA drift detector is wired", () => {
  it("scripts/drift-check.ts exists and references PRODUCTION_DOMAIN", () => {
    const path = join(process.cwd(), "scripts", "drift-check.ts");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    expect(src).toMatch(/PRODUCTION_DOMAIN/);
  });

  it("daily drift-check workflow exists and runs the drift script", () => {
    const path = join(
      process.cwd(),
      ".github",
      "workflows",
      "config-drift.yml",
    );
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf8");
    // Must run on a daily schedule.
    expect(src).toMatch(/cron:\s*["']0\s+\d+\s+\*\s+\*\s+\*["']/);
    // Must invoke the drift-check script.
    expect(src).toMatch(/scripts\/drift-check\.ts/);
  });

  it("EXPECTED_BUNDLESOCIAL_WEBHOOK_URL is the canonical production URL", async () => {
    const { EXPECTED_BUNDLESOCIAL_WEBHOOK_URL, PRODUCTION_DOMAIN } =
      await import("@/lib/config/production-urls");
    // The historic typo'd domain that caused the May 2026 outage.
    expect(PRODUCTION_DOMAIN).not.toContain("opollo.vercel.app");
    expect(EXPECTED_BUNDLESOCIAL_WEBHOOK_URL).toContain(
      "opollo-site-builder.vercel.app",
    );
  });
});
