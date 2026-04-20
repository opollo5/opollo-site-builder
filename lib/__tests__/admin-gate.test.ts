import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  __resetAuthKillSwitchCacheForTests,
} from "@/lib/auth-kill-switch";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2c-2 — checkAdminAccess gate.
//
// Pins the decision tree:
//   1. FEATURE_SUPABASE_AUTH off                     → allow, user: null.
//   2. FEATURE_SUPABASE_AUTH on + kill switch on     → allow, user: null.
//   3. FEATURE_SUPABASE_AUTH on + no session         → redirect /login.
//   4. FEATURE_SUPABASE_AUTH on + viewer role        → redirect /.
//   5. FEATURE_SUPABASE_AUTH on + admin/operator     → allow, user: {…}.
//
// createRouteAuthClient uses next/headers cookies() which only works
// inside a request scope — we mock it and feed in a standalone supabase
// client that's either anon (no session) or signed-in via password.
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
          "admin-gate.test: mockState.client not set before checkAdminAccess",
        );
      }
      return mockState.client;
    },
  };
});

import { checkAdminAccess } from "@/lib/admin-gate";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "admin-gate.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
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

describe("checkAdminAccess: FEATURE_SUPABASE_AUTH off", () => {
  it("allows access with user: null (Basic Auth path, no role check)", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    mockState.client = anonClient();

    const result = await checkAdminAccess();
    expect(result.kind).toBe("allow");
    if (result.kind === "allow") {
      expect(result.user).toBeNull();
    }
  });
});

describe("checkAdminAccess: FEATURE_SUPABASE_AUTH on, kill switch on", () => {
  it("allows access with user: null (break-glass)", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    await setKillSwitchRow("on");
    mockState.client = anonClient();

    const result = await checkAdminAccess();
    expect(result.kind).toBe("allow");
    if (result.kind === "allow") {
      expect(result.user).toBeNull();
    }
  });
});

describe("checkAdminAccess: FEATURE_SUPABASE_AUTH on, kill switch off", () => {
  beforeEach(async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    await setKillSwitchRow(null);
  });

  it("redirects to /login when there is no session", async () => {
    mockState.client = anonClient();

    const result = await checkAdminAccess();
    expect(result).toEqual({ kind: "redirect", to: "/login" });
  });

  it("redirects viewers to /", async () => {
    const viewer = await seedAuthUser({ role: "viewer" });
    mockState.client = await signedInClient(viewer.email);

    const result = await checkAdminAccess();
    expect(result).toEqual({ kind: "redirect", to: "/" });
  });

  it("allows operators and threads the user through", async () => {
    const operator = await seedAuthUser({ role: "operator" });
    mockState.client = await signedInClient(operator.email);

    const result = await checkAdminAccess();
    expect(result.kind).toBe("allow");
    if (result.kind === "allow") {
      expect(result.user?.role).toBe("operator");
      expect(result.user?.email).toBe(operator.email);
    }
  });

  it("allows admins and threads the user through", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const result = await checkAdminAccess();
    expect(result.kind).toBe("allow");
    if (result.kind === "allow") {
      expect(result.user?.role).toBe("admin");
    }
  });
});
