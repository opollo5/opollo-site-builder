#!/usr/bin/env -S npx tsx
/**
 * sync-first-admin.ts
 *
 * One-shot deploy utility. Upserts OPOLLO_FIRST_ADMIN_EMAIL from the
 * environment into the opollo_config table, keyed 'first_admin_email'.
 *
 * When a user signs up through Supabase Auth with that email, the
 * handle_new_auth_user trigger (supabase/migrations/0004_m2a_auth_link.sql)
 * auto-promotes them to role='admin' instead of the default 'viewer'.
 * Every other signup stays 'viewer' until an admin promotes them via the
 * M2d admin UI.
 *
 *   OPOLLO_FIRST_ADMIN_EMAIL=you@example.com \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/sync-first-admin.ts
 *
 * Idempotent — re-running with the same value is a no-op; re-running with a
 * different value moves the bootstrap target. There's no guard against
 * moving the target after the first admin already exists: the trigger
 * only fires on new signups, so changing the value later doesn't
 * retroactively demote anyone.
 */

import { createClient } from "@supabase/supabase-js";

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const email = process.env.OPOLLO_FIRST_ADMIN_EMAIL;
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!email) die("OPOLLO_FIRST_ADMIN_EMAIL is not set.");
  if (!url) die("SUPABASE_URL is not set.");
  if (!serviceRoleKey) die("SUPABASE_SERVICE_ROLE_KEY is not set.");

  // Cheap email sanity — full validation happens at Supabase Auth signup.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    die(`OPOLLO_FIRST_ADMIN_EMAIL does not look like an email: ${email}`);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { error } = await supabase
    .from("opollo_config")
    .upsert(
      { key: "first_admin_email", value: email },
      { onConflict: "key" },
    );

  if (error) {
    die(`upsert opollo_config failed: ${error.message}`);
  }

  console.log(
    `[sync-first-admin] first_admin_email set to "${email}". When that email signs up via Supabase Auth, the handle_new_auth_user trigger will promote the user to role='admin'.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
