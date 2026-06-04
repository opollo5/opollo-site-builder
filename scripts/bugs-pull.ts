// scripts/bugs-pull.ts — pull feedback tickets into docs/bugs/<slug>.md
//
// Usage: npm run bugs:pull
//
// Fetches all non-deleted tickets in {backlog, triaged, in_progress} status,
// ordered by priority then severity, and writes/updates docs/bugs/<slug>.md
// idempotently. Safe to run multiple times.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.

import { pullBugs } from "@/lib/feedback/repo-bridge/pull";

async function main() {
  console.log("[bugs:pull] Starting…");
  const result = await pullBugs();
  console.log(`[bugs:pull] Done — ${result.written} written, ${result.errors} errors`);
  if (result.errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[bugs:pull] Fatal:", err);
  process.exit(1);
});
