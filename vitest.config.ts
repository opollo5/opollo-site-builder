import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Array form so `server-only` can match a regex pattern. Next.js's
    // bundler resolves `server-only` via its `react-server` export
    // condition; vitest doesn't match that condition and would
    // otherwise hit the package's default throw-at-import module.
    // The package's own `empty.js` isn't exposed via its exports field,
    // so we alias to a local zero-content stub instead. Result: vitest
    // sees a no-op, the Next.js bundler enforces the real guard.
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
    globalSetup: ["./lib/__tests__/_globalSetup.ts"],
    setupFiles: ["./lib/__tests__/_setup.ts"],
    include: ["lib/__tests__/**/*.test.ts"],
    testTimeout: 15_000,
    hookTimeout: 60_000,
    // Tests share one Supabase stack. fileParallelism: false forces files to
    // run serially, which avoids cross-test TRUNCATE races when multiple
    // files hit the same database.
    fileParallelism: false,
    coverage: {
      // V8 over istanbul — faster, no source-map round-trip, supported
      // directly by vitest 4.x.
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Only instrument what we write. Everything under node_modules,
      // .next, app router client islands (mostly shadcn wrappers), and
      // test helpers is excluded so the number reflects *our* code.
      include: ["lib/**/*.ts", "app/**/*.ts"],
      exclude: [
        "lib/__tests__/**",
        "lib/**/*.test.ts",
        "app/**/loading.tsx",
        "app/**/error.tsx",
        "app/**/not-found.tsx",
        "**/*.d.ts",
      ],
      // Soft thresholds for now — the codebase has well-covered hot
      // paths (lib/batch-*, lib/sites, lib/auth*) plus lower-coverage
      // thin API wrappers. 60% line / 55% branch is comfortably under
      // current baseline so CI stays green; ratchet upward as the
      // hot-path surface grows. A future follow-up will per-directory
      // the thresholds once we have stable numbers.
      thresholds: {
        lines: 60,
        branches: 55,
        functions: 55,
        statements: 60,
      },
    },
  },
});
