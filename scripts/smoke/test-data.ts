/**
 * scripts/smoke/test-data.ts
 *
 * Exports smoke test identifiers from environment variables.
 * Set these before running smoke tests:
 *
 *   SMOKE_TEST_COMPANY_ID   — UUID of the test company
 *   SMOKE_TEST_CONNECTION_ID — UUID of a live social connection for the test company
 *   SMOKE_CAP_SUBSCRIPTION_ID — UUID of an active CAP subscription (for PR 3.3)
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. Set it before running smoke tests.`,
    );
  }
  return value;
}

export function getTestCompanyId(): string {
  return requireEnv("SMOKE_TEST_COMPANY_ID");
}

export function getTestConnectionId(): string {
  return requireEnv("SMOKE_TEST_CONNECTION_ID");
}

export function getCapSubscriptionId(): string {
  return requireEnv("SMOKE_CAP_SUBSCRIPTION_ID");
}
