import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Component/hook tests — runs in jsdom, no Supabase stack required.
// Use:  npm run test:components
//
// Deliberately separate from vitest.config.ts (server tests) so CI can
// run component tests without `supabase start`. The two configs share
// the same alias + server-only stub so import paths resolve identically.

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
      {
        find: /^next\/navigation$/,
        replacement: path.resolve(
          __dirname,
          "components/__tests__/_next-navigation-stub.ts",
        ),
      },
      {
        find: /^next\/font\/google$/,
        replacement: path.resolve(
          __dirname,
          "components/__tests__/_next-font-stub.ts",
        ),
      },
    ],
  },
  test: {
    name: "components",
    environment: "jsdom",
    setupFiles: ["./components/__tests__/_setup.ts"],
    include: ["components/__tests__/**/*.test.{ts,tsx}"],
    testTimeout: 10_000,
    globals: true,
    // No globalSetup — intentionally no Supabase.
    // No fileParallelism constraint — tests are stateless.
  },
});
