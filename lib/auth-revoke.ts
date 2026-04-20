import { Client } from "pg";

// ---------------------------------------------------------------------------
// M2c-1 — server-side session revocation by user_id.
//
// Split from lib/auth.ts because this module imports `pg` (Node-only).
// Middleware runs on Edge and never imports from here, so the Edge
// bundle stays free of pg. Route handlers and background jobs (Node)
// import signOutAuthUser directly from "@/lib/auth-revoke".
//
// Why a direct Postgres DELETE and not the Supabase admin API: there
// is no admin-by-user-id logout endpoint in supabase-auth (GoTrue). The
// SDK's `auth.admin.signOut(jwt, scope)` requires a JWT, and we only
// hold the user_id at role-change time. Deleting the rows in
// auth.sessions + auth.refresh_tokens is the mechanism the Supabase
// dashboard's "Sign out user" action uses; any previously-issued JWT
// fails `auth.getUser()` on the next call because the `sid` claim's
// session lookup returns empty.
//
// Post-condition pinned by lib/__tests__/auth.test.ts: revocation is
// observable on the very next getCurrentUser() call, not deferred to
// the JWT's natural TTL.
// ---------------------------------------------------------------------------

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by signOutAuthUser to revoke " +
        "auth.sessions / auth.refresh_tokens rows. In Supabase production, " +
        "use the direct-connection string from Project Settings → Database.",
    );
  }
  return url;
}

/**
 * Revoke every active session for a user. Called by M2d on role
 * promotion/demotion and by M2c-3's emergency reset-role route.
 *
 * Opens a short-lived Postgres connection (not a pool — this is called
 * rarely, once per role change), deletes the user's sessions and
 * refresh tokens, and closes. Idempotent: running on a user with no
 * sessions is a no-op.
 */
export async function signOutAuthUser(userId: string): Promise<void> {
  const client = new Client({ connectionString: requireDbUrl() });
  await client.connect();
  try {
    // refresh_tokens references sessions via session_id with ON DELETE
    // CASCADE, so deleting sessions would sweep refresh tokens anyway.
    // We delete both explicitly to keep the intent legible and to guard
    // against future schema changes that loosen the CASCADE.
    await client.query(
      "DELETE FROM auth.refresh_tokens WHERE user_id = $1",
      [userId],
    );
    await client.query("DELETE FROM auth.sessions WHERE user_id = $1", [
      userId,
    ]);
  } finally {
    await client.end();
  }
}
