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
// M2d-1 — requireAdminForApi.
//
// Mirrors admin-gate.test.ts but for the route-handler helper. Pins:
//   1. FEATURE_SUPABASE_AUTH off                  → allow, user: null.
//   2. FEATURE_SUPABASE_AUTH on + kill switch on  → allow, user: null.
//   3. FEATURE_SUPABASE_AUTH on + no session      → 401 UNAUTHORIZED.
//   4. FEATURE_SUPABASE_AUTH on + wrong role      → 403 FORBIDDEN.
//   5. FEATURE_SUPABASE_AUTH on + allowed role    → allow, user: {…}.
//
// Same mocking pattern as admin-gate.test.ts: stub createRouteAuthClient
// to return a standalone supabase-js client.
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
          "admin-api-gate.test: mockState.client not set before requireAdminForApi",
        );
      }
      return mockState.client;
    },
  };
});

import { requireAdminForApi } from "@/lib/admin-api-gate";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "admin-api-gate.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
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

describe("requireAdminForApi: FEATURE_SUPABASE_AUTH off", () => {
  it("allows with user: null (Basic Auth path)", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    mockState.client = anonClient();

    const gate = await requireAdminForApi();
    expect(gate.kind).toBe("allow");
    if (gate.kind === "allow") expect(gate.user).toBeNull();
  });
});

describe("requireAdminForApi: FEATURE_SUPABASE_AUTH on, kill switch on", () => {
  it("allows with user: null (break-glass)", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    await setKillSwitchRow("on");
    mockState.client = anonClient();

    const gate = await requireAdminForApi();
    expect(gate.kind).toBe("allow");
    if (gate.kind === "allow") expect(gate.user).toBeNull();
  });
});

describe("requireAdminForApi: FEATURE_SUPABASE_AUTH on, kill switch off", () => {
  beforeEach(async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    await setKillSwitchRow(null);
  });

  it("returns 401 UNAUTHORIZED when there is no session", async () => {
    mockState.client = anonClient();
    const gate = await requireAdminForApi();
    expect(gate.kind).toBe("deny");
    if (gate.kind !== "deny") throw new Error("unreachable");
    expect(gate.response.status).toBe(401);
    const body = await gate.response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 403 FORBIDDEN for an operator when admin is required", async () => {
    const operator = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(operator.email);

    const gate = await requireAdminForApi();
    expect(gate.kind).toBe("deny");
    if (gate.kind !== "deny") throw new Error("unreachable");
    expect(gate.response.status).toBe(403);
    const body = await gate.response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 FORBIDDEN for a viewer", async () => {
    const viewer = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(viewer.email);

    const gate = await requireAdminForApi();
    expect(gate.kind).toBe("deny");
    if (gate.kind !== "deny") throw new Error("unreachable");
    expect(gate.response.status).toBe(403);
  });

  it("allows an admin", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const gate = await requireAdminForApi();
    expect(gate.kind).toBe("allow");
    if (gate.kind !== "allow") throw new Error("unreachable");
    expect(gate.user?.role).toBe("admin");
    expect(gate.user?.email).toBe(admin.email);
  });

  it("honours a custom roles list (operator allowed when listed)", async () => {
    const operator = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(operator.email);

    const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
    expect(gate.kind).toBe("allow");
    if (gate.kind !== "allow") throw new Error("unreachable");
    expect(gate.user?.role).toBe("admin");
  });
});
