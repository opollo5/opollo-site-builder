import "server-only";

import { Client } from "pg";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M2c-1 — server-side session revocation.
//
// Split from lib/auth.ts because this module imports `pg` (Node-only).
// Middleware runs on Edge and never imports from here, so the Edge
// bundle stays free of pg. Route handlers and background jobs (Node)
// import directly from "@/lib/auth-revoke".
//
// Two revocation paths — callers pick the one that matches intent:
//
//   signOutAuthUser(userId)   — SOFT.
//                               Deletes auth.sessions and
//                               auth.refresh_tokens so the client can't
//                               auto-refresh past the event. Leaves the
//                               current access token alone (stock
//                               supabase/auth doesn't check sessions
//                               on /user), so role changes propagate
//                               on the next access-token refresh (up
//                               to the JWT TTL, default 1h).
//
//                               This is ENOUGH for routine role changes
//                               because lib/auth.ts getCurrentUser()
//                               reads opollo_users.role fresh per
//                               request. The demoted user sees the new
//                               role on the very next page load.
//
//   revokeUserSessions(userId) — HARD.
//                               Writes opollo_users.revoked_at = now()
//                               AND performs the soft sweep. Belt and
//                               braces:
//                                 - revoked_at is checked by
//                                   getCurrentUser() against JWT.iat —
//                                   ANY access token issued before the
//                                   mark is rejected with null.
//                                 - The soft sweep prevents silent
//                                   auto-refresh from producing a
//                                   post-mark session on the existing
//                                   refresh token.
//                               Used by the emergency /api/emergency
//                               route in M2c-3 and by any caller that
//                               needs immediate "kick them out now"
//                               semantics (compromised credentials,
//                               departing employee).
// ---------------------------------------------------------------------------

/**
 * Soft revocation. Deletes refresh tokens and sessions for `userId` via
 * a short-lived pg connection; idempotent if no rows exist. Does not
 * invalidate any already-issued access token — that relies on the
 * hard-revocation path below (revokeUserSessions) or on the access
 * token's natural TTL.
 */
export async function signOutAuthUser(userId: string): Promise<void> {
  const { requireDbConfig } = await import("@/lib/db-direct");
  const client = new Client(requireDbConfig());
  await client.connect();
  try {
    // refresh_tokens references sessions via session_id with ON DELETE
    // CASCADE in the standard supabase/auth schema, so deleting sessions
    // sweeps refresh tokens too. We delete both explicitly to keep the
    // intent legible and guard against future schema changes that might
    // loosen the CASCADE.
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

/**
 * Hard revocation. Sets opollo_users.revoked_at = now() so
 * getCurrentUser() rejects any JWT whose iat predates the mark, then
 * calls signOutAuthUser() to sweep sessions + refresh tokens.
 *
 * Idempotent: calling twice simply updates revoked_at to the second
 * invocation's now().
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("opollo_users")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) {
    throw new Error(
      `revokeUserSessions(${userId}): opollo_users update failed — ${error.message}`,
    );
  }

  await signOutAuthUser(userId);
}
