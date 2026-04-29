// Sweep optimiser fixtures created by E2E specs (Slice 9). Other
// tables remain operator-managed — local devs keep state between runs
// intentionally for fast iteration; CI tears down the Supabase stack
// itself.

import { cleanupOptimiserFixtures } from "./optimiser-helpers";

export default async function globalTeardown(): Promise<void> {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await cleanupOptimiserFixtures();
    } catch (err) {
      // Don't fail the suite on teardown issues — surface in stderr
      // so CI output flags it without masking real failures.
      // eslint-disable-next-line no-console
      console.warn(
        `[optimiser-teardown] cleanup failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
