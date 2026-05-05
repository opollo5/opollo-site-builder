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
// M2d-1 — GET /api/admin/users/list.
//
// Pins:
//   - Flag off → 200, returns every opollo_users row.
//   - Flag on + no session → 401 UNAUTHORIZED.
//   - Flag on + non-admin role → 403 FORBIDDEN.
//   - Flag on + admin → 200, rows ordered newest-first.
//   - Payload includes revoked_at for revoked users.
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
          "admin-users-list.test: mockState.client not set before GET",
        );
      }
      return mockState.client;
    },
  };
});

import { GET as usersListGET } from "@/app/api/admin/users/list/route";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "admin-users-list.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
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

describe("GET /api/admin/users/list: auth", () => {
  it("returns 401 when the flag is on and no session is present", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    mockState.client = anonClient();

    const res = await usersListGET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 when the caller is an operator (admin-only)", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const op = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(op.email);

    const res = await usersListGET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the caller is a viewer", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const viewer = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(viewer.email);

    const res = await usersListGET();
    expect(res.status).toBe(403);
  });

  it("returns 200 when the flag is off (Basic Auth path)", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    await seedAuthUser({ role: "user" });
    mockState.client = anonClient();

    const res = await usersListGET();
    expect(res.status).toBe(200);
  });
});

describe("GET /api/admin/users/list: payload", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("returns every opollo_users row for an admin, newest first", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    // Seed a second user; the two timestamps are usually close enough
    // that ordering by created_at desc is still deterministic because
    // the second insert's now() > the first's.
    await new Promise((r) => setTimeout(r, 10));
    const viewer = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await usersListGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const users = body.data.users as Array<{
      id: string;
      role: string;
      email: string;
    }>;
    expect(users.length).toBe(2);
    // Newest (viewer, seeded second) comes first.
    expect(users[0]?.email).toBe(viewer.email);
    expect(users[1]?.email).toBe(admin.email);
  });

  it("includes revoked_at on a revoked row", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    const target = await seedAuthUser({ role: "admin" });

    const svc = getServiceRoleClient();
    const { error: updateErr } = await svc
      .from("opollo_users")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", target.id);
    expect(updateErr).toBeNull();

    mockState.client = await signedInClient(admin.email);

    const res = await usersListGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    const users = body.data.users as Array<{
      id: string;
      revoked_at: string | null;
    }>;
    const revokedRow = users.find((u) => u.id === target.id);
    expect(revokedRow?.revoked_at).not.toBeNull();
    const activeRow = users.find((u) => u.id === admin.id);
    expect(activeRow?.revoked_at).toBeNull();
  });
});
