import { defineConfig } from "vitest/config";
import path from "node:path";

// Golden-image test config (E7).
//
// Runs the golden-image snapshot tests with REAL sharp (no mock).
// Does NOT boot Supabase — these tests are renderer-only (no DB).
// Does NOT stub server-only — running in Node.js is a valid server context.
//
// Usage:
//   npm run test:golden            — compare against committed snapshots
//   UPDATE_GOLDEN=1 npm run test:golden  — regenerate snapshots

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // server-only: in Node.js test context this is a valid import; stub it
      // only to avoid the "This module cannot be imported from a Client Component"
      // error that the real package throws in non-RSC environments.
      {
        find: /^server-only$/,
        replacement: path.resolve(
          __dirname,
          "lib/__tests__/_server-only-stub.ts",
        ),
      },
    ],
  },
  test: {
    name: "golden",
    environment: "node",
    include: ["tests/golden/**/*.test.ts"],
    testTimeout: 60_000, // generous — sharp rsvg + PNG encode can be slow in CI
    // No globalSetup — no Supabase needed.
    // No fileParallelism — golden tests write/read snapshot files (sequential safe).
    fileParallelism: false,
  },
});
