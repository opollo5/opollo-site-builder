import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright config — Layer 7 production smoke.
//
// Runs against a LIVE production URL (not localhost), driven by a
// Vercel deploy hook → GitHub Actions workflow (.github/workflows/
// smoke.yml). Distinct from playwright.config.ts because:
//
// - No webServer / globalSetup / globalTeardown — the target is a
//   deployed Next.js, not a built-and-started one.
// - Test directory is `e2e/smoke/` only — the full e2e suite is too
//   heavy + many specs depend on writable seed data we don't want
//   touching prod.
// - Env-driven SMOKE_USER_EMAIL + SMOKE_USER_PASSWORD designate the
//   designated production smoke-test user. These are GitHub Action
//   secrets (PROD_SMOKE_USER_EMAIL, PROD_SMOKE_USER_PASSWORD); see
//   docs/test-coverage-target.md §7 for the batched ask to Steven.
// - PLAYWRIGHT_BASE_URL is the canonical production URL. The drift
//   detector pins this against lib/config/production-urls.ts.
// ---------------------------------------------------------------------------

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "playwright.smoke.config: PLAYWRIGHT_BASE_URL must be set to the production URL. See docs/runbooks/RUNBOOK.md.",
  );
}

export default defineConfig({
  testDir: "./e2e/smoke",
  fullyParallel: false,
  forbidOnly: true,
  retries: 1,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-smoke", open: "never" }],
    ["json", { outputFile: "playwright-smoke-results.json" }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders: {
      // The smoke-suite identifier so production logs can correlate
      // smoke traffic separately from real users / monitors.
      "x-opollo-smoke": "1",
    },
  },
  projects: [
    {
      name: "smoke-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
