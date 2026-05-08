import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// revalidatePath throws outside Next.js App Router — suppress in tests.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { __resetAuthKillSwitchCacheForTests } from "@/lib/auth-kill-switch";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser } from "./_auth-helpers";
import { seedSite } from "./_helpers";

// Spec 01 §3.2 — role-gate matrix for DELETE /api/sites/[id]/purge.
//
// Mirrors the admin-api-gate test harness: stub createRouteAuthClient
// so the route handler runs under a real Supabase session.
//
// Asserts:
//   - super_admin → 200 ok with deleted_by_table tally
//   - admin       → 403 FORBIDDEN
//   - user        → 403 FORBIDDEN
//   - no session  → 401 UNAUTHORIZED

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
          "sites-purge-permissions.test: mockState.client not set",
        );
      }
      return mockState.client;
    },
  };
});

import { DELETE } from "@/app/api/sites/[id]/purge/route";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "sites-purge-permissions.test: SUPABASE_URL + SUPABASE_ANON_KEY required",
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({
    email,
    password: "test-password-1234",
  });
  if (error) throw new Error(`signInWithPassword: ${error.message}`);
  return c;
}

async function setKillSwitchRow(value: string | null): Promise<void> {
  const svc = getServiceRoleClient();
  if (value === null) {
    await svc.from("opollo_config").delete().eq("key", "auth_kill_switch");
  } else {
    await svc
      .from("opollo_config")
      .upsert({ key: "auth_kill_switch", value }, { onConflict: "key" });
  }
  __resetAuthKillSwitchCacheForTests();
}

const ENV_KEYS = ["FEATURE_SUPABASE_AUTH"] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(async () => {
  originalEnv = {};
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  process.env.FEATURE_SUPABASE_AUTH = "true";
  await setKillSwitchRow(null);
  mockState.client = null;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  mockState.client = null;
  __resetAuthKillSwitchCacheForTests();
});

function buildRequest(siteId: string): Request {
  return new Request(`http://localhost/api/sites/${siteId}/purge`, {
    method: "DELETE",
  });
}

describe("DELETE /api/sites/[id]/purge — role gate", () => {
  it("returns 401 with no session", async () => {
    mockState.client = anonClient();
    const { id } = await seedSite();

    const res = await DELETE(buildRequest(id), { params: { id } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 for an admin", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);
    const { id } = await seedSite();

    const res = await DELETE(buildRequest(id), { params: { id } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for a user", async () => {
    const user = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(user.email);
    const { id } = await seedSite();

    const res = await DELETE(buildRequest(id), { params: { id } });
    expect(res.status).toBe(403);
  });

  it("returns 200 for a super_admin and removes the site", async () => {
    const su = await seedAuthUser({ role: "super_admin" });
    mockState.client = await signedInClient(su.email);
    const { id } = await seedSite();

    const res = await DELETE(buildRequest(id), { params: { id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.site_id).toBe(id);

    const svc = getServiceRoleClient();
    const { data: gone } = await svc
      .from("sites")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    expect(gone).toBeNull();
  });
});
