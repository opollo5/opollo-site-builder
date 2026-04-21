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
