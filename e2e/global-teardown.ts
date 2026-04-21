// No-op teardown for now. The CI workflow tears down the Supabase
// stack itself; local developers keep state between runs intentionally
// so iteration is fast. If E2E pollution becomes a problem we'll
// swap this for a TRUNCATE of test-owned rows.

export default async function globalTeardown(): Promise<void> {
  // Intentionally empty.
}
