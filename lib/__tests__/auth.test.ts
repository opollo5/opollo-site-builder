import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AuthError, getCurrentUser, requireRole } from "@/lib/auth";
import {
  signOutAuthUser,
  revokeUserSessions,
} from "@/lib/auth-revoke";
import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2c-1 — lib/auth.ts + lib/auth-revoke.ts.
//
// Design being pinned here (approved after PR #17's first failures forced
// a rethink — see the revocation comment block in lib/auth.ts):
//
//   ROLE CHANGES
//     getCurrentUser() looks up opollo_users.role fresh on every call.
//     Role is NOT embedded in the JWT. Demote / promote → the caller's
//     next request reflects the new role, zero revocation needed. The
//     "role change reflects immediately" test pins this.
//
//   HARD REVOCATION
//     revokeUserSessions(userId) writes opollo_users.revoked_at = now()
//     and deletes sessions + refresh_tokens. getCurrentUser() compares
//     the caller's JWT iat against revoked_at; pre-revocation tokens
//     return null. The "revokeUserSessions kicks the user out" test
//     pins this.
//
//   SOFT SIGN-OUT
//     signOutAuthUser(userId) just deletes sessions + refresh_tokens.
//     The current access token stays valid until its natural TTL; the
//     client can't auto-refresh. That's fine for "log this user out on
//     next refresh" flows and is explicitly NOT expected to drop a
//     live JWT immediately.
// ---------------------------------------------------------------------------

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "auth.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "test-password-1234",
  });
  if (error) throw new Error(`signedInClient: ${error.message}`);
  return client;
}

describe("getCurrentUser", () => {
  it("returns id/email/role for a signed-in viewer", async () => {
    const user = await seedAuthUser({ role: "viewer" });
    const client = await signedInClient(user.email);
    const result = await getCurrentUser(client);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(user.id);
    expect(result?.email).toBe(user.email);
    expect(result?.role).toBe("viewer");
  });

  it("returns the promoted role for admins and operators", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const operator = await seedAuthUser({ role: "operator" });

    const adminClient = await signedInClient(admin.email);
    const operatorClient = await signedInClient(operator.email);

    expect((await getCurrentUser(adminClient))?.role).toBe("admin");
    expect((await getCurrentUser(operatorClient))?.role).toBe("operator");
  });

  it("returns null when the client has no session", async () => {
    const client = anonClient();
    const result = await getCurrentUser(client);
    expect(result).toBeNull();
  });
});

describe("requireRole", () => {
  it("returns the user when their role matches", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const client = await signedInClient(user.email);
    const result = await requireRole(client, ["admin", "operator"]);
    expect(result.id).toBe(user.id);
    expect(result.role).toBe("operator");
  });

  it("throws AuthError(403) when role does not match", async () => {
    const user = await seedAuthUser({ role: "viewer" });
    const client = await signedInClient(user.email);
    let caught: unknown;
    try {
      await requireRole(client, ["admin", "operator"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(403);
  });

  it("throws AuthError(401) when there is no session", async () => {
    const client = anonClient();
    let caught: unknown;
    try {
      await requireRole(client, ["viewer"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).status).toBe(401);
  });
});

describe("role changes are per-request fresh", () => {
  it("reflects a server-side role demotion on the next getCurrentUser call", async () => {
    // Set up: operator signs in, lib sees them as operator.
    const user = await seedAuthUser({ role: "operator" });
    const client = await signedInClient(user.email);

    const before = await getCurrentUser(client);
    expect(before?.role).toBe("operator");

    // An admin (via M2d, via the trigger, via any service-role path)
    // demotes the user to viewer.
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("opollo_users")
      .update({ role: "viewer" })
      .eq("id", user.id);
    expect(error).toBeNull();

    // The very next getCurrentUser call — same client, same JWT —
    // reflects the new role. No revocation, no re-login. This is the
    // promise that lets M2d skip the sign-out dance for role changes.
    const after = await getCurrentUser(client);
    expect(after?.role).toBe("viewer");
  });
});

describe("revokeUserSessions — hard revocation", () => {
  it("rejects the user's pre-revocation access token on the next call", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const client = await signedInClient(user.email);

    // Sanity: session is live before revocation.
    const before = await getCurrentUser(client);
    expect(before?.id).toBe(user.id);

    // Ensure at least one second elapses between sign-in and the
    // revoked_at stamp so JWT.iat (second-resolution) predates
    // revoked_at (millisecond-resolution). Without this, iat * 1000 can
    // equal revoked_at_ms and the comparison `iat*1000 < revoked_at_ms`
    // becomes false on fast machines.
    await new Promise((r) => setTimeout(r, 1100));

    await revokeUserSessions(user.id);

    // Same client, same JWT — getCurrentUser rejects via the iat <
    // revoked_at gate.
    const after = await getCurrentUser(client);
    expect(after).toBeNull();
  });

  it("allows a fresh sign-in after revocation", async () => {
    const user = await seedAuthUser({ role: "operator" });
    await revokeUserSessions(user.id);

    // revocation leaves the user enabled — a new sign-in produces a
    // JWT with iat > revoked_at and passes the gate. The emergency
    // route relies on this: revoke doesn't brick the account, it
    // just forces a re-login.
    const client = await signedInClient(user.email);
    const result = await getCurrentUser(client);
    expect(result?.id).toBe(user.id);
    expect(result?.role).toBe("operator");
  });
});

describe("signOutAuthUser — soft sweep", () => {
  it("deletes refresh_tokens so silent auto-refresh can't continue", async () => {
    const user = await seedAuthUser({ role: "operator" });
    await signedInClient(user.email);

    // Belt check: there's at least one refresh_token row for this user
    // right after sign-in.
    const svc = getServiceRoleClient();
    const before = await countRefreshTokens(user.id);
    expect(before).toBeGreaterThan(0);

    await signOutAuthUser(user.id);

    const after = await countRefreshTokens(user.id);
    expect(after).toBe(0);

    // The user row itself is untouched — soft sweep doesn't ban or
    // delete the account.
    const { data: row } = await svc
      .from("opollo_users")
      .select("id,role,revoked_at")
      .eq("id", user.id)
      .maybeSingle();
    expect(row?.role).toBe("operator");
    expect(row?.revoked_at).toBeNull();
  });
});

// Helper: count auth.refresh_tokens rows for a user. Uses pg because
// auth.* isn't exposed via PostgREST by default.
async function countRefreshTokens(userId: string): Promise<number> {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString:
      process.env.SUPABASE_DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  });
  await client.connect();
  try {
    const res = await client.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM auth.refresh_tokens WHERE user_id = $1",
      [userId],
    );
    return parseInt(res.rows[0]?.n ?? "0", 10);
  } finally {
    await client.end();
  }
}
