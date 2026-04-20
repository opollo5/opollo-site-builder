import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AuthError,
  getCurrentUser,
  requireRole,
  signOutAuthUser,
} from "@/lib/auth";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2c-1 — lib/auth.ts helpers.
//
// These tests exercise getCurrentUser / requireRole / signOutAuthUser
// against the real local Supabase stack. The middleware-side cookie
// adapter isn't exercised here — that runs in Edge and the SSR client
// is constructed fresh per request. These tests stand in for the
// runtime flow by building an anon supabase-js client, signing in, and
// passing it directly to getCurrentUser — same auth.getUser() codepath
// the SSR client uses.
//
// CRITICAL pin (from Steven's M2c refinement #3): revocation must be
// observable on the NEXT request via auth.getUser(), not deferred to
// the JWT's natural expiry. The "revokes sessions immediately" test
// below fails if anyone accidentally switches to getSession() or skips
// signOutAuthUser.
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

describe("signOutAuthUser — revocation regression", () => {
  it("revokes the session immediately on the next getUser() call", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const client = await signedInClient(user.email);

    // Sanity check: the session is live BEFORE revocation.
    const before = await getCurrentUser(client);
    expect(before?.id).toBe(user.id);

    await signOutAuthUser(user.id);

    // The same client still has the (now-revoked) JWT stored locally.
    // Because getCurrentUser uses supabase.auth.getUser() — the
    // server-verified codepath — GoTrue rejects the revoked JWT and
    // we get null on the very next call. If anyone ever regresses to
    // getSession() (which decodes the cookie locally), this assertion
    // fails.
    const after = await getCurrentUser(client);
    expect(after).toBeNull();
  });
});
