import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
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
  },
});
