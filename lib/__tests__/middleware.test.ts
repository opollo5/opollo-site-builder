import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { middleware } from "@/middleware";
import { getServiceRoleClient } from "@/lib/supabase";
import { __resetAuthKillSwitchCacheForTests } from "@/lib/auth-kill-switch";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2c-1 — middleware behaviour matrix.
//
// The three cells we care most about:
//   1. FEATURE_SUPABASE_AUTH off → byte-identical legacy Basic Auth path.
//   2. FEATURE_SUPABASE_AUTH on  + no session → redirect /login (HTML) /
//                                               401 JSON (/api).
//   3. FEATURE_SUPABASE_AUTH on  + kill switch on → falls back to Basic
//                                                   Auth (break-glass).
// Plus:
//   - public paths bypass the gate.
//   - binary failure under flag-on returns 500 / /auth-error, never
//     silently falls through to Basic Auth.
//   - revoked session: signOutAuthUser takes effect on the next request
//     (redundantly pinned; primary pin is in auth.test.ts).
// ---------------------------------------------------------------------------

// Store the real env so we can reset between tests.
const ENV_KEYS = [
  "FEATURE_SUPABASE_AUTH",
  "BASIC_AUTH_USER",
  "BASIC_AUTH_PASSWORD",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
] as const;

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

async function clearKillSwitchRow(): Promise<void> {
  const svc = getServiceRoleClient();
  await svc.from("opollo_config").delete().eq("key", "auth_kill_switch");
}

async function setKillSwitchRow(value: string): Promise<void> {
  const svc = getServiceRoleClient();
  await svc
    .from("opollo_config")
    .upsert({ key: "auth_kill_switch", value }, { onConflict: "key" });
}

function makeRequest(
  pathname: string,
  init?: { authHeader?: string; cookies?: { name: string; value: string }[] },
): NextRequest {
  const url = `http://localhost:3000${pathname}`;
  const headers = new Headers();
  if (init?.authHeader) headers.set("authorization", init.authHeader);
  if (init?.cookies && init.cookies.length > 0) {
    headers.set(
      "cookie",
      init.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    );
  }
  return new NextRequest(url, { headers });
}

// ---------------------------------------------------------------------------
// Flag off — legacy Basic Auth path.
// ---------------------------------------------------------------------------

describe("middleware: FEATURE_SUPABASE_AUTH off (Basic Auth path)", () => {
  it("passes through when no BASIC_AUTH_* creds are set", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASSWORD;

    const res = await middleware(makeRequest("/admin/sites"));
    expect(res.status).toBe(200);
  });

  it("returns 401 with WWW-Authenticate when creds set but header missing", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    process.env.BASIC_AUTH_USER = "opollo";
    process.env.BASIC_AUTH_PASSWORD = "secret";

    const res = await middleware(makeRequest("/admin/sites"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");
  });

  it("accepts a correctly-encoded Basic auth header", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    process.env.BASIC_AUTH_USER = "opollo";
    process.env.BASIC_AUTH_PASSWORD = "secret";

    const encoded = Buffer.from("opollo:secret").toString("base64");
    const res = await middleware(
      makeRequest("/admin/sites", { authHeader: `Basic ${encoded}` }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a wrong Basic auth password", async () => {
    delete process.env.FEATURE_SUPABASE_AUTH;
    process.env.BASIC_AUTH_USER = "opollo";
    process.env.BASIC_AUTH_PASSWORD = "secret";

    const encoded = Buffer.from("opollo:nope").toString("base64");
    const res = await middleware(
      makeRequest("/admin/sites", { authHeader: `Basic ${encoded}` }),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Flag on — Supabase Auth path.
// ---------------------------------------------------------------------------

describe("middleware: FEATURE_SUPABASE_AUTH on, no session", () => {
  beforeEach(async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    await clearKillSwitchRow();
    __resetAuthKillSwitchCacheForTests();
  });

  it("redirects HTML pages to /login with ?next=", async () => {
    const res = await middleware(makeRequest("/admin/sites"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin%2Fsites");
  });

  it("returns 401 JSON on /api routes", async () => {
    const res = await middleware(makeRequest("/api/sites"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("lets /login, /logout, /auth-error, /api/auth/callback through unauthenticated", async () => {
    for (const p of ["/login", "/logout", "/auth-error", "/api/auth/callback"]) {
      const res = await middleware(makeRequest(p));
      expect(res.status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// Flag on, kill switch on — break-glass to Basic Auth.
// ---------------------------------------------------------------------------

describe("middleware: FEATURE_SUPABASE_AUTH on, kill switch on", () => {
  it("falls back to the Basic Auth path", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    process.env.BASIC_AUTH_USER = "opollo";
    process.env.BASIC_AUTH_PASSWORD = "secret";
    await setKillSwitchRow("on");
    __resetAuthKillSwitchCacheForTests();

    // No Basic header → 401 from the Basic Auth gate, not a redirect to
    // /login from the Supabase Auth gate.
    const res = await middleware(makeRequest("/admin/sites"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Basic");

    // Correct Basic creds → 200 through the legacy path.
    const encoded = Buffer.from("opollo:secret").toString("base64");
    const ok = await middleware(
      makeRequest("/admin/sites", { authHeader: `Basic ${encoded}` }),
    );
    expect(ok.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Flag on, binary failure — must fail closed, not fall through.
// ---------------------------------------------------------------------------

describe("middleware: FEATURE_SUPABASE_AUTH on, binary failure", () => {
  it("returns 500 with AUTH_UNAVAILABLE on /api when SSR client construction throws", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    // Basic creds are set — the test proves we do NOT fall through to them.
    process.env.BASIC_AUTH_USER = "opollo";
    process.env.BASIC_AUTH_PASSWORD = "secret";
    await clearKillSwitchRow();
    __resetAuthKillSwitchCacheForTests();

    delete process.env.SUPABASE_URL;

    const res = await middleware(makeRequest("/api/sites"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("AUTH_UNAVAILABLE");
    // Critical: no WWW-Authenticate header — we did not silently fall
    // through to the Basic Auth path.
    expect(res.headers.get("www-authenticate")).toBeNull();
  });

  it("redirects HTML requests to /auth-error when SSR client construction throws", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    process.env.BASIC_AUTH_USER = "opollo";
    process.env.BASIC_AUTH_PASSWORD = "secret";
    await clearKillSwitchRow();
    __resetAuthKillSwitchCacheForTests();

    delete process.env.SUPABASE_URL;

    const res = await middleware(makeRequest("/admin/sites"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth-error");
    expect(res.headers.get("www-authenticate")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Flag on + valid session → pass through.
// ---------------------------------------------------------------------------

async function buildSessionCookies(
  accessToken: string,
  refreshToken: string,
): Promise<{ name: string; value: string }[]> {
  const captured: { name: string; value: string }[] = [];
  const client = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach((c) =>
            captured.push({ name: c.name, value: c.value }),
          );
        },
      },
    },
  );
  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw new Error(`buildSessionCookies: ${error.message}`);
  return captured;
}

async function signInAndGetTokens(email: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: "test-password-1234",
  });
  if (error || !data.session) {
    throw new Error(`signIn: ${error?.message ?? "no session"}`);
  }
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  };
}

describe("middleware: FEATURE_SUPABASE_AUTH on, valid session", () => {
  it("passes HTML pages through when the session cookie is valid", async () => {
    process.env.FEATURE_SUPABASE_AUTH = "true";
    await clearKillSwitchRow();
    __resetAuthKillSwitchCacheForTests();

    const user = await seedAuthUser({ role: "viewer" });
    const { accessToken, refreshToken } = await signInAndGetTokens(user.email);
    const cookies = await buildSessionCookies(accessToken, refreshToken);

    const res = await middleware(makeRequest("/admin/sites", { cookies }));
    expect(res.status).toBe(200);
  });
});
