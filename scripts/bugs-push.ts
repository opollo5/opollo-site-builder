// scripts/bugs-push.ts — push docs/bugs/<slug>.md status/PR → Supabase
//
// Usage: npm run bugs:push
//
// Parses front-matter from docs/bugs/*.md and writes back only
// status ∈ {in_progress, fixed} and linked_pr_url. Terminal states
// (verified, closed, wont_fix) are REJECTED per the governance contract
// (§1 of the feedback build spec — humans close tickets, not automation).
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.

import { pushBugs } from "@/lib/feedback/repo-bridge/push";

async function main() {
  console.log("[bugs:push] Starting…");
  const result = await pushBugs();
  console.log(
    `[bugs:push] Done — ${result.updated} updated, ${result.skipped} skipped, ` +
      `${result.rejected} rejected (terminal state), ${result.errors} errors`,
  );
  if (result.rejected > 0) {
    console.error("[bugs:push] REJECTED terminal state attempts — see logs above.");
    process.exit(1);
  }
  if (result.errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[bugs:push] Fatal:", err);
  process.exit(1);
});
