import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Layer 1 (unit) + Layer 2 (contract) tests — no Supabase, no I/O.
//
// Use:  npm run test:unit
//       npm run test:contract
//
// Why a third config:
//
//   - vitest.config.ts boots `supabase start` in globalSetup. The cold
//     start adds 15–30 s to every run and requires Docker locally;
//     unit + contract tests don't need it. Running them through that
//     config wastes time and blocks anyone without Docker.
//   - vitest.components.config.ts targets jsdom. Unit/contract tests
//     run in node (they exercise lib/* server code with mocks).
//
// Convention:
//   *.contract.test.ts  — Layer 2: snapshot the exact outgoing
//                         payload to a third-party SDK or HTTP API.
//   *.unit.test.ts      — Layer 1: pure logic, no I/O, all deps
//                         mocked. Runs in <5s.
//
// Existing `lib/__tests__/*.test.ts` files that already mock all I/O
// (no `getServiceRoleClient()` calls) could move here later for
// faster CI feedback, but the migration is opt-in to keep this PR
// scope small.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
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
    name: "unit",
    environment: "node",
    include: [
      "lib/__tests__/**/*.contract.test.ts",
      "lib/__tests__/**/*.unit.test.ts",
      "tests/regressions/**/*.test.{ts,tsx}",
      "tests/security/**/*.security.test.ts",
    ],
    testTimeout: 10_000,
    // No globalSetup — no Supabase. Tests must mock all I/O.
    // No fileParallelism constraint — tests are stateless.
  },
});
