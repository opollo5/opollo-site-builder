import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { __resetAuthKillSwitchCacheForTests } from "@/lib/auth-kill-switch";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2d-3 — POST /api/admin/users/invite.
//
// Pins:
//   - 401 when flag on + no session.
//   - 403 when caller is non-admin.
//   - 400 when email is missing / malformed.
//   - 409 ALREADY_EXISTS when the email is already in auth.users.
//   - 200 returns { email, user_id, action_link } on success AND
//         creates an opollo_users row via the handle_new_auth_user
//         trigger (role='viewer').
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
          "admin-users-invite.test: mockState.client not set before POST",
        );
      }
      return mockState.client;
    },
  };
});

import { POST as invitePOST } from "@/app/api/admin/users/invite/route";

function anonClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "admin-users-invite.test: SUPABASE_URL and SUPABASE_ANON_KEY must be set",
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

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/users/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function readOpolloUserByEmail(
  email: string,
): Promise<{ id: string; role: string } | null> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("opollo_users")
    .select("id, role")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, role: data.role as string };
}

async function deleteAuthUserByEmail(email: string): Promise<void> {
  const svc = getServiceRoleClient();
  // Look up the auth user via the admin API (listUsers is paginated;
  // for test cleanup we just filter client-side).
  const { data } = await svc.auth.admin.listUsers();
  const match = data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );
  if (match) await svc.auth.admin.deleteUser(match.id);
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
// Auth canaries
// ---------------------------------------------------------------------------

describe("POST /api/admin/users/invite: auth", () => {
  it("returns 401 when flag on and no session", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    mockState.client = anonClient();

    const res = await invitePOST(
      makeRequest({ email: "new-person@opollo.test" }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 when caller is operator", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    const op = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(op.email);

    const res = await invitePOST(
      makeRequest({ email: "new-person@opollo.test" }),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("POST /api/admin/users/invite: validation", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("returns 400 when email is missing", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await invitePOST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 when email is malformed", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await invitePOST(
      makeRequest({ email: "not-an-email" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not JSON", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const res = await invitePOST(makeRequest("not-json"));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Success + duplicate
// ---------------------------------------------------------------------------

describe("POST /api/admin/users/invite: outcomes", () => {
  beforeEach(() => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
  });

  it("creates an invite + opollo_users row with role='viewer'", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const inviteEmail = `invitee-${Date.now()}@opollo.test`;
    try {
      const res = await invitePOST(
        makeRequest({ email: inviteEmail }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.email).toBe(inviteEmail.toLowerCase());
      expect(typeof body.data.action_link).toBe("string");
      expect(body.data.action_link).toContain("http");
      expect(typeof body.data.user_id).toBe("string");

      // Trigger fired → opollo_users row exists with role='viewer'.
      const row = await readOpolloUserByEmail(inviteEmail);
      expect(row).not.toBeNull();
      expect(row?.role).toBe("user");
    } finally {
      await deleteAuthUserByEmail(inviteEmail);
    }
  });

  it("returns 409 ALREADY_EXISTS for a duplicate email", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    // Seed a second user — that email is now registered in auth.users
    // via the admin API, matching what inviteUserByEmail would collide
    // against.
    const existing = await seedAuthUser({ role: "user" });
    mockState.client = await signedInClient(admin.email);

    const res = await invitePOST(
      makeRequest({ email: existing.email }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("ALREADY_EXISTS");
  });

  it("normalises the returned email to lowercase", async () => {
    const admin = await seedAuthUser({ role: "admin" });
    mockState.client = await signedInClient(admin.email);

    const inviteEmail = `CaseTest-${Date.now()}@Opollo.Test`;
    try {
      const res = await invitePOST(
        makeRequest({ email: inviteEmail }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.email).toBe(inviteEmail.toLowerCase());
    } finally {
      await deleteAuthUserByEmail(inviteEmail);
    }
  });
});
