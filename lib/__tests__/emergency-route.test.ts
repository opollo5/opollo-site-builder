import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";

import { __resetAuthKillSwitchCacheForTests } from "@/lib/auth-kill-switch";
import { getServiceRoleClient } from "@/lib/supabase";

import { POST as emergencyPOST } from "@/app/api/emergency/route";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2c-3 — POST /api/emergency.
//
// Pins the behaviour matrix:
//   1. OPOLLO_EMERGENCY_KEY unset / <32 chars → 503 EMERGENCY_NOT_CONFIGURED.
//   2. Wrong key → 401 UNAUTHORIZED (constant-time comparison).
//   3. Bad body → 400 VALIDATION_FAILED.
//   4. kill_switch_on → opollo_config row present with value='on'.
//   5. kill_switch_off → opollo_config row absent.
//   6. revoke_user → opollo_users.revoked_at stamped + refresh tokens gone.
// ---------------------------------------------------------------------------

const KEY_32 =
  "0123456789abcdef0123456789abcdef"; // exactly 32 chars
const WRONG_KEY_32 =
  "ffffffffffffffffffffffffffffffff";

const ENV_KEYS = ["OPOLLO_EMERGENCY_KEY"] as const;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  originalEnv = {};
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
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
  vi.restoreAllMocks();
});

function makeRequest(
  body: unknown,
  init?: { key?: string; auth?: "custom" | "bearer" },
): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init?.key) {
    if (init.auth === "bearer") {
      headers["authorization"] = `Bearer ${init.key}`;
    } else {
      headers["x-opollo-emergency-key"] = init.key;
    }
  }
  return new Request("http://localhost:3000/api/emergency", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readKillSwitchRow(): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("opollo_config")
    .select("value")
    .eq("key", "auth_kill_switch")
    .maybeSingle();
  return (data?.value as string | undefined) ?? null;
}

async function countRefreshTokens(userId: string): Promise<number> {
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

async function signedInClient(email: string): Promise<SupabaseClient> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "emergency-route.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
    );
  }
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "test-password-1234",
  });
  if (error) throw new Error(`signedInClient: ${error.message}`);
  return client;
}

// ---------------------------------------------------------------------------
// Auth surface
// ---------------------------------------------------------------------------

describe("POST /api/emergency: authentication", () => {
  it("returns 503 when OPOLLO_EMERGENCY_KEY is unset", async () => {
    delete process.env.OPOLLO_EMERGENCY_KEY;
    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("EMERGENCY_NOT_CONFIGURED");
  });

  it("returns 503 when OPOLLO_EMERGENCY_KEY is shorter than 32 chars", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = "too-short";
    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }, { key: "too-short" }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("EMERGENCY_NOT_CONFIGURED");
  });

  it("returns 401 when no key header is present", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when the key is wrong (same length)", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }, { key: WRONG_KEY_32 }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 when the key is wrong (different length)", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await emergencyPOST(
      makeRequest(
        { action: "kill_switch_on" },
        { key: `${KEY_32}-extra` },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("accepts the key via Authorization: Bearer", async () => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
    const res = await emergencyPOST(
      makeRequest(
        { action: "kill_switch_on" },
        { key: KEY_32, auth: "bearer" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("POST /api/emergency: validation", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("returns 400 when body has no action", async () => {
    const res = await emergencyPOST(makeRequest({}, { key: KEY_32 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when action is unknown", async () => {
    const res = await emergencyPOST(
      makeRequest({ action: "eject" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for revoke_user without user_id", async () => {
    const res = await emergencyPOST(
      makeRequest({ action: "revoke_user" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for revoke_user with a non-UUID user_id", async () => {
    const res = await emergencyPOST(
      makeRequest(
        { action: "revoke_user", user_id: "not-a-uuid" },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not JSON", async () => {
    const req = new Request("http://localhost:3000/api/emergency", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opollo-emergency-key": KEY_32,
      },
      body: "not-json",
    });
    const res = await emergencyPOST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("POST /api/emergency: kill_switch_on / kill_switch_off", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("kill_switch_on upserts opollo_config.auth_kill_switch = 'on'", async () => {
    expect(await readKillSwitchRow()).toBeNull();

    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.action).toBe("kill_switch_on");

    expect(await readKillSwitchRow()).toBe("on");
  });

  it("kill_switch_on is idempotent", async () => {
    await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }, { key: KEY_32 }),
    );
    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(200);
    expect(await readKillSwitchRow()).toBe("on");
  });

  it("kill_switch_off removes the opollo_config row", async () => {
    await emergencyPOST(
      makeRequest({ action: "kill_switch_on" }, { key: KEY_32 }),
    );
    expect(await readKillSwitchRow()).toBe("on");

    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_off" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.action).toBe("kill_switch_off");

    expect(await readKillSwitchRow()).toBeNull();
  });

  it("kill_switch_off is idempotent when no row exists", async () => {
    expect(await readKillSwitchRow()).toBeNull();
    const res = await emergencyPOST(
      makeRequest({ action: "kill_switch_off" }, { key: KEY_32 }),
    );
    expect(res.status).toBe(200);
    expect(await readKillSwitchRow()).toBeNull();
  });
});

describe("POST /api/emergency: revoke_user", () => {
  beforeEach(() => {
    process.env.OPOLLO_EMERGENCY_KEY = KEY_32;
  });

  it("stamps opollo_users.revoked_at and sweeps refresh tokens", async () => {
    const user = await seedAuthUser({ role: "admin" });
    await signedInClient(user.email);

    // Sanity: refresh token exists before revoke.
    expect(await countRefreshTokens(user.id)).toBeGreaterThan(0);

    const res = await emergencyPOST(
      makeRequest(
        { action: "revoke_user", user_id: user.id },
        { key: KEY_32 },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user_id).toBe(user.id);

    expect(await countRefreshTokens(user.id)).toBe(0);

    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("opollo_users")
      .select("revoked_at")
      .eq("id", user.id)
      .maybeSingle();
    expect(data?.revoked_at).not.toBeNull();
  });
});
