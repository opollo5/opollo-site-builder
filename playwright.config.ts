import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Playwright configuration — Level 1 + 2 E2E suite.
//
// Design choices:
//
// - **Target: localhost in CI**, not Vercel preview. Preview deploys use
//   the production Supabase URL; running E2E against prod would pollute
//   real data. A dedicated staging Supabase project is future work. For
//   now the webServer block builds Next.js once and starts it on 3000,
//   and a per-run local Supabase (from `supabase start`) backs it with
//   fresh data. Same stack the unit suite uses.
//
// - **Single Chromium project.** Multi-browser (Firefox, WebKit) is
//   overkill for a single-operator admin surface today; every extra
//   project multiplies runtime and flakiness surface.
//
// - **snapshotPathTemplate pins Linux baselines** so CI-generated
//   screenshots don't thrash against developer-local ones. Local dev
//   should run `npm run test:e2e -- --update-snapshots` on Linux (or
//   skip visual regression specs locally). Visual regression specs
//   themselves arrive in a follow-up PR — first-run baselines need to
//   be captured in CI and committed before the gate turns on.
//
// - **Strict + trace on retry**: fail fast on test file issues, capture
//   traces only when a retry happens so CI artifacts stay small.
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-linux{ext}",
  // Start Next.js in production mode + use a seeded test user in
  // local Supabase (see e2e/global-setup.ts). The server is reused if
  // something is already listening — developers iterating locally
  // skip the boot delay between runs.
  webServer: {
    command: process.env.CI
      ? "npm run build && npm run start"
      : "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Opt-in: Playwright runs with FEATURE_SUPABASE_AUTH=true so the
      // admin-layout gate is on and the sign-in flow is exercised.
      FEATURE_SUPABASE_AUTH: "true",
      // M12-6 — deterministic CRON_SECRET so the brief-runner cron
      // endpoint accepts Bearer tokens from the E2E spec. Shared via
      // e2e/fixtures.ts::E2E_CRON_SECRET. Matches the 16-char minimum
      // the cron route enforces.
      CRON_SECRET: "e2e-cron-secret-deterministic",
    },
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
});
