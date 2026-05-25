import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright configuration — UAT harness suite.
//
// Runs against the live staging deployment, NOT a local Next.js server.
// Required env vars (set in GitHub Actions secrets + .env.uat locally):
//   UAT_BASE_URL          — staging Vercel URL (default: branch alias)
//   STAGING_UAT_SECRET    — bearer token for /api/uat/sign-in
//   STAGING_UAT_EMAIL     — ghost user email (default: uat-bot@staging.opollo.com)
//   VERCEL_BYPASS_SECRET  — Vercel Protection Bypass for Automation token
//                           (needed if staging branch has Preview Protection on)
//
// DO NOT use `page.waitForLoadState('networkidle')` in this suite.
// Playwright documents it as discouraged because real pages keep
// background requests open indefinitely (telemetry, websockets,
// realtime channels). Issue #1049 traced 25+ UAT failures to this
// anti-pattern. Use explicit web assertions instead:
//   await expect(locator).toBeVisible({ timeout: 10_000 });
// Ref: https://playwright.dev/docs/api/class-page#page-wait-for-load-state
// A CI gate in .github/workflows/button-migration-gates.yml fails any
// PR that reintroduces it.
// ---------------------------------------------------------------------------

const UAT_BASE_URL =
  process.env.UAT_BASE_URL ??
  "https://opollo-site-builder-git-staging-opollo5.vercel.app";

export default defineConfig({
  testDir: "./e2e/uat",
  // Diagnostic specs live under e2e/diagnostics/ and run on demand only.
  testIgnore: ["**/diagnostics/**"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-uat", open: "never" }],
    ["json", { outputFile: "test-results/uat/results.json" }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results/uat",
  use: {
    baseURL: UAT_BASE_URL,
    trace: "on",
    video: "retain-on-failure",
    screenshot: "on",
    // Vercel Protection Bypass for Automation — needed when staging Preview
    // Protection is on. Add VERCEL_BYPASS_SECRET to GitHub Actions secrets
    // and to Vercel Project Settings → Deployment Protection → Protection
    // Bypass for Automation.
    extraHTTPHeaders: process.env.VERCEL_BYPASS_SECRET
      ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS_SECRET }
      : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-linux{ext}",
  // No webServer block — tests run against the live staging deployment.
});
