import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { __resetAuthKillSwitchCacheForTests } from "@/lib/auth-kill-switch";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2d-4 — POST /api/admin/users/[id]/revoke + /reinstate.
//
// Revoke is the "kick them out AND block sign-in" combo:
//   1. auth.admin.updateUserById ban_duration = long
//   2. revokeUserSessions (stamps revoked_at + sweeps sessions)
//
// Reinstate is the inverse: ban_duration = 'none' + clear revoked_at.
//
// Pins:
//   - revoke guardrails: 400 non-uuid, 401 no session, 403 operator,
//     404 not-found, 409 CANNOT_MODIFY_SELF, 409 LAST_ADMIN.
//   - revoke effect: opollo_users.revoked_at set; auth.users
//     banned_until in the future; refresh_tokens gone.
//   - reinstate effect: revoked_at cleared; banned_until cleared;
//     idempotent on already-active user with changed: false.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
}));

vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => {
      if (!mockState.client) {
        throw new Error(
          "admin-users-revoke.test: mockState.client not set",
        );
      }
      return mockState.client;
    },
  };
});

import { POST as revokePOST } from "@/app/api/admin/users/[id]/revoke/route";
import { POST as reinstatePOST } from "@/app/api/admin/users/[id]/reinstate/route";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "admin-users-revoke.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
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

function makeRequest(id: string): Request {
  return new Request(
    `http://localhost:3000/api/admin/users/${id}/revoke`,
    { method: "POST" },
  );
}

async function readRevokedAt(userId: string): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("opollo_users")
    .select("revoked_at")
    .eq("id", userId)
    .maybeSingle();
  return (data?.revoked_at as string | null | undefined) ?? null;
}

async function readBannedUntil(userId: string): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data } = await svc.auth.admin.getUserById(userId);
  const banned = (data?.user as { banned_until?: string | null } | null)
    ?.banned_until;
  return banned ?? null;
}

const ENV_KEYS = ["FEATURE_SUPABASE_AUTH"] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = {};
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  mockState.client = null;
  __resetAuthKillSwitchCacheForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = originalEnv[k];
    }
  }
  mockState.client = null;
  __resetAuthKillSwitchCacheForTests();
});

// ---------------------------------------------------------------------------
// Revoke — auth / validation
// ---------------------------------------------------------------------------

describe("POST /api/admin/users/[id]/revoke: auth + validation", () => {
  it("returns 401 when flag on and no session", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const target = await seedAuthUser({ role: "user" });
    mockState.client = anonClient();

    const res = await revokePOST(makeRequest(target.id), {
      params: { id: target.id },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is operator", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const op = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(op.email);

    const res = await revokePOST(makeRequest(target.id), {
      params: { id: target.id },
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 on non-UUID id", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await revokePOST(makeRequest("not-a-uuid"), {
      params: { id: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Revoke — guardrails
// ---------------------------------------------------------------------------

describe("POST /api/admin/users/[id]/revoke: guardrails", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("returns 404 when target does not exist", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await revokePOST(makeRequest(fakeId), {
      params: { id: fakeId },
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 CANNOT_MODIFY_SELF when admin revokes themself", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await revokePOST(makeRequest(admin.id), {
      params: { id: admin.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CANNOT_MODIFY_SELF");
  });

  it("returns 409 LAST_ADMIN when revoking the only active admin", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    // Flag-off path to sidestep the self-guard (no caller identity to
    // collide with the target).
    delete process.env.FEATURE_SUPABASE_AUTH;
    mockState.client = anonClient();

    const res = await revokePOST(makeRequest(admin.id), {
      params: { id: admin.id },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("LAST_ADMIN");
  });

  // M15-4 regression. Pinning the sibling invariant from the /role PATCH
  // route: the LAST_ADMIN count must only include active admins. A
  // revoked row with role='admin' does not satisfy the floor. Both routes
  // now share the countActiveAdmins() helper in lib/auth.ts so this
  // contract cannot drift again.
  it(
    "LAST_ADMIN counts only active admins — revoked admins do not prop up the count",
    async () => {
      const activeAdmin = await seedAuthUser({ role: "admin" });
      const revokedAdmin = await seedAuthUser({ role: "admin" });

      const svc = getServiceRoleClient();
      const { error: revokeErr } = await svc
        .from("opollo_users")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", revokedAdmin.id);
      expect(revokeErr).toBeNull();

      delete process.env.FEATURE_SUPABASE_AUTH;
      mockState.client = anonClient();

      const res = await revokePOST(makeRequest(activeAdmin.id), {
        params: { id: activeAdmin.id },
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("LAST_ADMIN");

      // The active admin's revoked_at must still be null — the guard
      // must short-circuit before any mutation.
      expect(await readRevokedAt(activeAdmin.id)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Revoke — success effects
// ---------------------------------------------------------------------------

describe("POST /api/admin/users/[id]/revoke: effects", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("stamps revoked_at, bans in auth.users, and sweeps sessions", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "admin" });
    // Seed a refresh token so we can verify it gets swept.
    await signedInClient(target.email);

    mockState.client = await signedInClient(admin.email);

    const res = await revokePOST(makeRequest(target.id), {
      params: { id: target.id },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(true);

    expect(await readRevokedAt(target.id)).not.toBeNull();

    const bannedUntil = await readBannedUntil(target.id);
    expect(bannedUntil).not.toBeNull();
    // banned_until is set to ~now + 876000h; just assert it's in the future.
    expect(new Date(bannedUntil!).getTime()).toBeGreaterThan(
      Date.now() + 1_000_000,
    );

    // Verify the target can no longer sign in with password — the ban
    // blocks signInWithPassword at the GoTrue layer. This is the
    // crucial property that distinguishes revoke from a role change.
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({
      email: target.email,
      password: "test-password-1234",
    });
    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reinstate
// ---------------------------------------------------------------------------

describe("POST /api/admin/users/[id]/reinstate", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("requires admin (403 operator)", async () => {
    const op = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(op.email);

    const res = await reinstatePOST(
      new Request(
        `http://localhost:3000/api/admin/users/${target.id}/reinstate`,
        { method: "POST" },
      ),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(403);
  });

  it("clears revoked_at and unbans, restoring sign-in", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "admin" });
    await signedInClient(target.email);

    mockState.client = await signedInClient(admin.email);

    // Revoke first.
    const revokeRes = await revokePOST(makeRequest(target.id), {
      params: { id: target.id },
    });
    expect(revokeRes.status).toBe(200);
    expect(await readRevokedAt(target.id)).not.toBeNull();

    // Now reinstate.
    const reinstateRes = await reinstatePOST(
      new Request(
        `http://localhost:3000/api/admin/users/${target.id}/reinstate`,
        { method: "POST" },
      ),
      { params: { id: target.id } },
    );
    expect(reinstateRes.status).toBe(200);
    const body = await reinstateRes.json();
    expect(body.data.revoked).toBe(false);
    expect(body.data.changed).toBe(true);

    expect(await readRevokedAt(target.id)).toBeNull();

    // Sign-in should work again.
    const fresh = anonClient();
    const { error } = await fresh.auth.signInWithPassword({
      email: target.email,
      password: "test-password-1234",
    });
    expect(error).toBeNull();
  });

  it("is idempotent on an already-active user with changed: false", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await reinstatePOST(
      new Request(
        `http://localhost:3000/api/admin/users/${target.id}/reinstate`,
        { method: "POST" },
      ),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.revoked).toBe(false);
    expect(body.data.changed).toBe(false);
  });

  it("returns 404 when target does not exist", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await reinstatePOST(
      new Request(
        `http://localhost:3000/api/admin/users/${fakeId}/reinstate`,
        { method: "POST" },
      ),
      { params: { id: fakeId } },
    );
    expect(res.status).toBe(404);
  });
});
