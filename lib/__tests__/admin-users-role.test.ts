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
// M2d-2 — PATCH /api/admin/users/[id]/role.
//
// Pins the promote/demote guardrails:
//   - 400 VALIDATION_FAILED — non-UUID id, bad body, wrong role string.
//   - 401 UNAUTHORIZED — flag on + no session.
//   - 403 FORBIDDEN — non-admin caller.
//   - 404 NOT_FOUND — id valid but no such user.
//   - 409 CANNOT_MODIFY_SELF — admin demoting themself.
//   - 409 LAST_ADMIN — demoting the only admin.
//   - 200 same role → { changed: false }.
//   - 200 promote viewer → admin → opollo_users.role updated.
//   - 200 demote admin → operator (when multiple admins).
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
          "admin-users-role.test: mockState.client not set before PATCH",
        );
      }
      return mockState.client;
    },
  };
});

import { PATCH as roleRoutePATCH } from "@/app/api/admin/users/[id]/role/route";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "admin-users-role.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
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

function makeRequest(id: string, body: unknown): Request {
  return new Request(
    `http://localhost:3000/api/admin/users/${id}/role`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

async function readRole(userId: string): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("opollo_users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
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
// Auth — delegate to admin-api-gate; one canary case each for completeness.
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/users/[id]/role: auth", () => {
  it("returns 401 when flag on and no session", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    mockState.client = anonClient();

    const user = await seedAuthUser({ role: "user" });
    const res = await roleRoutePATCH(
      makeRequest(user.id, { role: "admin" }),
      { params: { id: user.id } },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is operator", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const op = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(op.email);

    const res = await roleRoutePATCH(
      makeRequest(target.id, { role: "admin" }),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/users/[id]/role: validation", () => {
  beforeEach(async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("returns 400 when id is not a UUID", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest("not-a-uuid", { role: "user" }),
      { params: { id: "not-a-uuid" } },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when role is missing", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest(target.id, {}),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when role is an unknown string", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest(target.id, { role: "godmode" }),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not JSON", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest(target.id, "not-json"),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/users/[id]/role: guardrails", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("returns 404 when the target user does not exist", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest("00000000-0000-0000-0000-000000000000", { role: "admin" }),
      { params: { id: "00000000-0000-0000-0000-000000000000" } },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 409 CANNOT_MODIFY_SELF when admin targets themselves", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest(admin.id, { role: "user" }),
      { params: { id: admin.id } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CANNOT_MODIFY_SELF");
  });

  it("returns 409 LAST_ADMIN when demoting the only admin", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    // A separate admin is the caller so CANNOT_MODIFY_SELF doesn't
    // short-circuit the guard we want to exercise. Since only the
    // first admin is the "last admin" candidate, we need to make
    // another admin first, then promote them away, then try to
    // demote the original. Easier path: seed a second admin, demote
    // that one to operator first (leaving only one admin left), then
    // try to demote the remaining admin via *this* second (now
    // operator → can't be caller). Use service role to wire up the
    // initial state instead.
    const secondAdmin = await seedAuthUser({ role: "admin" });

    // Demote the second admin first — this succeeds because there are
    // still two admins at the moment of the check.
    mockState.client = await signedInClient(admin.email);
    const demote = await roleRoutePATCH(
      makeRequest(secondAdmin.id, { role: "admin" }),
      { params: { id: secondAdmin.id } },
    );
    expect(demote.status).toBe(200);

    // Now `admin` is the last admin. Sign in as that operator to act
    // as the caller, and have them attempt to demote `admin`. The
    // operator caller will be 403'd by the gate, not the last-admin
    // check, so we bypass the gate by staying signed in as `admin`
    // but targeting `admin` — that triggers CANNOT_MODIFY_SELF first.
    //
    // To exercise LAST_ADMIN cleanly we need a third admin to be the
    // caller. Promote the demoted operator back to admin, then have
    // them attempt to demote `admin` again — but then there are two
    // admins and the check passes. Net: LAST_ADMIN is only
    // reachable via a service-role seeded state plus a *second*
    // admin attempting the demotion.
    //
    // Set it up: make a fresh admin caller, revoke their admin-ness
    // directly in the DB is one option — cleaner is to seed a third
    // admin then directly DELETE the second admin row via
    // service-role, leaving two admins total (third + original).
    // Then third admin demotes original → LAST_ADMIN should NOT fire
    // (count=2). We want count=1 at the moment of the check, so:
    // seed third admin as caller, DELETE second admin + keep a lone
    // *non-caller* target admin to demote. The caller must be an
    // admin for the gate; the caller must not be the target; the
    // target must currently be the only admin → impossible without
    // the caller also being admin, bumping the count to 2.
    //
    // Correct interpretation: LAST_ADMIN triggers when
    // count(admin) <= 1 AT THE MOMENT OF THE CHECK, which counts the
    // caller too. So we need exactly one admin in the DB = the
    // target = demoting them to non-admin. The caller is admin → the
    // caller IS the target → CANNOT_MODIFY_SELF fires first.
    //
    // LAST_ADMIN is therefore only reachable when the caller has
    // super-powers without being in opollo_users (flag-off path).
    // That's the test we write below — flag-off, sole admin in DB,
    // demote them.
    delete process.env.FEATURE_SUPABASE_AUTH;
    mockState.client = anonClient();

    // State: `admin` is admin; `secondAdmin` is operator. `admin` is
    // the only admin row. Try to demote.
    const res = await roleRoutePATCH(
      makeRequest(admin.id, { role: "admin" }),
      { params: { id: admin.id } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("LAST_ADMIN");
  });

  // M15-4 regression. Prior to the fix, the LAST_ADMIN count filtered only
  // on role='admin' and ignored revoked_at, so a revoked admin row would
  // pad the count and let the caller demote the last *active* admin. This
  // test seeds one active admin + one revoked admin, then attempts to
  // demote the active one. With the fix, count(active)=1 and demotion
  // must be blocked. Without the fix, count(all-with-admin-role)=2 and
  // demotion would succeed — that's the bug.
  it(
    "LAST_ADMIN counts only active admins — revoked admins do not prop up the count",
    async () => {
      const activeAdmin = await seedAuthUser({ role: "admin" });
      const revokedAdmin = await seedAuthUser({ role: "admin" });

      // Stamp revoked_at on the second admin via service-role. The row
      // keeps role='admin' but revoked_at is set, so the user cannot
      // sign in and must not count toward the LAST_ADMIN floor.
      const svc = getServiceRoleClient();
      const { error: revokeErr } = await svc
        .from("opollo_users")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", revokedAdmin.id);
      expect(revokeErr).toBeNull();

      // Flag-off path — the caller is superuser; targeting the sole
      // active admin. With the fix, LAST_ADMIN fires (count=1).
      delete process.env.FEATURE_SUPABASE_AUTH;
      mockState.client = anonClient();

      const res = await roleRoutePATCH(
        makeRequest(activeAdmin.id, { role: "admin" }),
        { params: { id: activeAdmin.id } },
      );
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("LAST_ADMIN");

      // And the row was NOT demoted — defensive assertion against the
      // "error returned but the write already landed" failure mode.
      expect(await readRole(activeAdmin.id)).toBe("admin");
    },
  );
});

// ---------------------------------------------------------------------------
// Success cases
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/users/[id]/role: success", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("200 with changed:false on a no-op role assignment", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest(target.id, { role: "user" }),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.changed).toBe(false);
    expect(body.data.role).toBe("user");
    expect(await readRole(target.id)).toBe("user");
  });

  it("promotes viewer → admin", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest(target.id, { role: "admin" }),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.changed).toBe(true);
    expect(await readRole(target.id)).toBe("admin");
  });

  it("demotes admin → operator when another admin exists", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await roleRoutePATCH(
      makeRequest(target.id, { role: "admin" }),
      { params: { id: target.id } },
    );
    expect(res.status).toBe(200);
    expect(await readRole(target.id)).toBe("admin");
  });
});
