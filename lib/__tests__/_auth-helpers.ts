import { getServiceRoleClient } from "@/lib/supabase";

// Test-only factories for M2+ auth scenarios. Every caller uses the
// service-role supabase-js client — we want the same HTTP + trigger path
// the admin API uses, not raw SQL inserts that skip the trigger.

export type TestRole = "admin" | "operator" | "viewer";

export type SeededAuthUser = {
  id: string;
  email: string;
  role: TestRole;
};

let emailCounter = 0;

/**
 * Creates an auth.users row via the admin API. The
 * handle_new_auth_user trigger (0004 migration) inserts the matching
 * opollo_users row with role='viewer' (or 'admin' if opollo_config's
 * first_admin_email matches). When `overrides.role` is supplied and
 * differs from the trigger's choice, we UPDATE the opollo_users row
 * post-insert so the test gets the requested role.
 *
 * `email_confirm: true` skips Supabase Auth's confirmation flow — we
 * don't want the test harness dealing with inbucket / email links.
 */
export async function seedAuthUser(overrides?: {
  email?: string;
  password?: string;
  role?: TestRole;
}): Promise<SeededAuthUser> {
  const supabase = getServiceRoleClient();
  const email = overrides?.email ?? `test-user-${++emailCounter}@opollo.test`;
  const password = overrides?.password ?? "test-password-1234";

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw new Error(
      `seedAuthUser: admin.createUser failed — ${error?.message ?? "no user"}`,
    );
  }
  const userId = data.user.id;

  // If a role was requested, reconcile. Default case (viewer) is fine.
  if (overrides?.role && overrides.role !== "viewer") {
    const { error: updateErr } = await supabase
      .from("opollo_users")
      .update({ role: overrides.role })
      .eq("id", userId);
    if (updateErr) {
      throw new Error(
        `seedAuthUser: role update to ${overrides.role} failed — ${updateErr.message}`,
      );
    }
  }

  return {
    id: userId,
    email,
    role: overrides?.role ?? "viewer",
  };
}

/**
 * Upsert opollo_config.first_admin_email. Passing `null` deletes the row,
 * unsetting the bootstrap rule — matches what scripts/sync-first-admin.ts
 * does except this helper works against an empty value too for
 * exhaustive test coverage.
 */
export async function setFirstAdminEmail(email: string | null): Promise<void> {
  const supabase = getServiceRoleClient();
  if (email === null) {
    const { error } = await supabase
      .from("opollo_config")
      .delete()
      .eq("key", "first_admin_email");
    if (error) throw new Error(`setFirstAdminEmail(null) failed: ${error.message}`);
    return;
  }
  const { error } = await supabase
    .from("opollo_config")
    .upsert(
      { key: "first_admin_email", value: email },
      { onConflict: "key" },
    );
  if (error) throw new Error(`setFirstAdminEmail("${email}") failed: ${error.message}`);
}

/**
 * Sign a user in and return the session's access-token JWT. Callers use
 * this as a Bearer token when hitting route handlers that gate on
 * authenticated requests (M2c+). For M2a itself the tests don't exercise
 * session flow, so this is here for M2b/M2c to consume.
 */
export async function signInAs(
  user: { email: string; password?: string },
): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password ?? "test-password-1234",
  });
  if (error || !data.session) {
    throw new Error(
      `signInAs(${user.email}): ${error?.message ?? "no session"}`,
    );
  }
  return data.session.access_token;
}
