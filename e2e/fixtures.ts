// Shared fixtures for the Playwright suite.
//
// Credentials are deterministic — the global-setup script seeds them,
// every spec signs in as this user. A production Supabase must NEVER
// have this account; the Playwright CI runs against a local
// `supabase start` stack.

export const E2E_ADMIN_EMAIL = "playwright-admin@opollo.test";
export const E2E_ADMIN_PASSWORD = "playwright-password-1234";

// Pre-seeded test site (global-setup inserts if missing).
export const E2E_TEST_SITE_PREFIX = "e2e";

// M12-6 — deterministic cron secret, matched in playwright.config.ts's
// webServer.env.CRON_SECRET. Used by the brief-runner cron driver in
// briefs-full-loop.spec.ts to advance the runner one tick at a time.
// Never used in production — staging + prod cron secrets live in
// deploy-time env.
export const E2E_CRON_SECRET = "e2e-cron-secret-deterministic";

// P-Brand-1d — customer-facing brand profile spec.
// Credentials for a seeded company admin on the platform (not Opollo admin).
export const E2E_CUSTOMER_EMAIL = "playwright-customer@opollo.test";
export const E2E_CUSTOMER_PASSWORD = "playwright-password-1234";
export const E2E_CUSTOMER_COMPANY_SLUG = "e2e-customer-co";
