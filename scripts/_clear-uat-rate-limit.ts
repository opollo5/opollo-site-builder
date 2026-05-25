#!/usr/bin/env -S npx tsx
// scripts/_clear-uat-rate-limit.ts
// One-shot: clears login_challenges rows for the UAT bot on staging.
// Hard-fails if SUPABASE_URL doesn't contain the staging project ref.

import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "bjiiqnetaxoibhcaukqm";
const UAT_EMAIL = "uat-bot@staging.opollo.com";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url.includes(STAGING_REF)) {
  console.error(`HARD FAIL: SUPABASE_URL does not contain staging ref '${STAGING_REF}'. Got: ${url || "(empty)"}`);
  process.exit(1);
}
if (!key) {
  console.error("HARD FAIL: SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(1);
}

async function main() {
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  // Resolve the UAT user ID via the admin API.
  const { data: users, error: listErr } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) { console.error("listUsers failed:", listErr.message); process.exit(1); }

  const uat = users.users.find((u) => u.email === UAT_EMAIL);
  if (!uat) { console.error(`UAT user '${UAT_EMAIL}' not found in staging auth.users`); process.exit(1); }
  console.log(`UAT user ID: ${uat.id}`);

  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();

  const { count: before, error: countErr } = await sb
    .from("login_challenges")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", uat.id)
    .gte("created_at", oneHourAgo);
  if (countErr) { console.error("count failed:", countErr.message); process.exit(1); }
  console.log(`Challenges in last hour (before clear): ${before ?? 0}`);

  // Delete all challenges for this user — they are synthetic; no residue needed.
  const { error: delErr, count: delCount } = await sb
    .from("login_challenges")
    .delete({ count: "exact" })
    .eq("user_id", uat.id);
  if (delErr) { console.error("delete failed:", delErr.message); process.exit(1); }
  console.log(`Deleted rows: ${delCount ?? 0}`);

  const { count: after, error: afterErr } = await sb
    .from("login_challenges")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", uat.id)
    .gte("created_at", oneHourAgo);
  if (afterErr) { console.error("verify failed:", afterErr.message); process.exit(1); }
  console.log(`Challenges in last hour (after clear): ${after ?? 0}`);

  if ((after ?? 0) > 0) {
    console.error("Clear did not fully drain. Remaining:", after);
    process.exit(1);
  }
  console.log("OK — UAT user rate limit cleared. Steven can log in now.");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
