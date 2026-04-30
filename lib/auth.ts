import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { cookies as nextCookies } from "next/headers";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M2c-1 — server-side auth plumbing.
//
// Exposes three layers:
//
// 1. Cookie-adapter factories for the two runtimes we care about:
//    - createMiddlewareAuthClient(req) — for middleware.ts (Edge runtime)
//    - createRouteAuthClient()         — for route handlers + server
//                                        components (Node runtime)
//
// 2. Identity readers that ALWAYS call supabase.auth.getUser() — the
//    server-verified variant that contacts GoTrue. Never getSession(),
//    which only decodes the cookie locally and would make revocation
//    effectively lag by the JWT TTL. The revocation regression test in
//    lib/__tests__/auth.test.ts pins this.
//
// 3. requireRole + signOutAuthUser — the gate and the revocation hook
//    that M2c-2's route guards and M2c-3's emergency route call.
//
// Runtime notes:
//   - createServerClient from @supabase/ssr is fetch-based and works on
//     Edge. Middleware uses Edge by default; we don't set a runtime
//     directive anywhere.
//   - getServiceRoleClient() is only called from Node runtime (route
//     handlers / server components) — it's not referenced from the
//     middleware path.
// ---------------------------------------------------------------------------

// AUTH-FOUNDATION P3 (2026-04-30): role enum migrated from
// (admin, operator, viewer) to (super_admin, admin, user). Migration
// 0057 maps existing rows: viewer→user, operator→admin, admin stays
// admin (with hi@opollo.com promoted to super_admin via the same
// migration). Trusted-operator gating that previously required
// admin OR operator now requires super_admin OR admin.
export type Role = "super_admin" | "admin" | "user";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
};

export class AuthError extends Error {
  public readonly status: 401 | 403;
  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Cookie adapters
// ---------------------------------------------------------------------------

/**
 * Build an SSR supabase client whose cookie adapter is threaded through
 * the middleware request/response pair. Returns the client plus a
 * mutable NextResponse — when Supabase refreshes the session mid-request
 * it writes the updated cookies onto that response, so the caller must
 * either return this response or copy its cookies onto its final
 * response (see copyAuthCookies).
 */
export function createMiddlewareAuthClient(request: NextRequest): {
  supabase: SupabaseClient;
  response: NextResponse;
} {
  let response = NextResponse.next({ request });

  const cookies: CookieMethodsServer = {
    getAll() {
      return request.cookies
        .getAll()
        .map((c) => ({ name: c.name, value: c.value }));
    },
    setAll(cookiesToSet) {
      // Mirror the refreshed cookies onto both the (immutable) inbound
      // request snapshot and the outbound response. Rebuilding the
      // response is the documented Next 14 pattern — it ensures that
      // the refreshed cookies are visible to downstream getAll() calls
      // within the same request AND are Set-Cookie'd back to the
      // browser.
      cookiesToSet.forEach(({ name, value }) => {
        request.cookies.set(name, value);
      });
      response = NextResponse.next({ request });
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    },
  };

  const supabase = createServerClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    { cookies },
  );

  return { supabase, response };
}

/**
 * Build an SSR supabase client for use inside route handlers or server
 * components. Uses next/headers cookies(). setAll swallows errors when
 * called from a server component (Next forbids mutating cookies there);
 * middleware handles the refresh in that case.
 */
export function createRouteAuthClient(): SupabaseClient {
  const cookieStore = nextCookies();

  const cookies: CookieMethodsServer = {
    getAll() {
      return cookieStore
        .getAll()
        .map((c) => ({ name: c.name, value: c.value }));
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set({ name, value, ...options });
        });
      } catch {
        // Called from a Server Component — mutation not allowed here.
        // Middleware refreshes the cookie on the next request.
      }
    },
  };

  return createServerClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    { cookies },
  );
}

/**
 * Copy auth-related Set-Cookie headers from one response to another.
 * Middleware helpers use this when they build a redirect or JSON error
 * but want to preserve Supabase's refreshed session cookies on the
 * outbound response.
 */
export function copyAuthCookies(
  from: NextResponse,
  to: NextResponse,
): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
  return to;
}

// ---------------------------------------------------------------------------
// Identity readers.
//
// getUser() is the server-verified path — it contacts GoTrue on every
// call to check JWT signature, expiry, and user existence. We never
// use getSession() for authZ decisions (it only decodes the cookie
// locally and trusts what's there).
//
// Role + app-layer revocation both live on opollo_users:
//   - role is looked up fresh per request. M2d role changes take
//     effect on the very next request with no JWT invalidation
//     needed — there is no role claim embedded in the JWT.
//   - revoked_at is the "kick this user out right now" marker. Any
//     access token whose iat claim predates revoked_at is rejected
//     here. This is the app-layer revocation that stock supabase/auth
//     cannot do on its own (its /user endpoint only checks
//     signature/expiry, not session existence). The emergency route
//     (M2c-3) and lib/auth-revoke.ts revokeUserSessions() set this.
// ---------------------------------------------------------------------------

// Decode the iat (issued-at) claim from an access-token JWT. We don't
// verify the signature here — getUser() already did that server-side.
// This only extracts a claim we trust. Returns null on malformed input.
function decodeJwtIat(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    // atob is available in both Edge and Node 16+ runtimes.
    const payload = JSON.parse(atob(padded)) as { iat?: number };
    return typeof payload.iat === "number" ? payload.iat : null;
  } catch {
    return null;
  }
}

export async function getCurrentUser(
  supabase: SupabaseClient,
): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Role + revocation lookup via service-role to bypass RLS. Service-role
  // is what the M2a trigger uses and what every existing route handler
  // uses — consistent path across the app.
  const svc = getServiceRoleClient();
  const { data: profile, error: profileErr } = await svc
    .from("opollo_users")
    .select("role,email,revoked_at")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileErr || !profile) return null;

  // App-layer revocation check.
  //
  // JWT.iat is second-precision; revoked_at is ms-precision. We MUST
  // floor revoked_at to the same second before comparing — otherwise a
  // fresh sign-in whose iat rounds down to the same wall-clock second
  // as the revocation stamp is wrongly rejected. Concretely:
  //   iat           = floor(signInMs / 1000) = T_sec
  //   revoked_at_ms = T_sec * 1000 + 200 (stamp 200 ms after T_sec)
  //   naive: iat * 1000 < revoked_at_ms → T_sec*1000 < T_sec*1000+200 → TRUE → REJECTED (wrong)
  //   fixed: iat < floor(revoked_at_ms / 1000) → T_sec < T_sec → FALSE → allowed
  //
  // Bias at the same-second boundary is toward the caller. That's safe
  // because revokeUserSessions() stamps revoked_at AND immediately calls
  // signOutAuthUser() (delete refresh_tokens/sessions); any pre-stamp
  // JWT whose cookie is still present has already lost its refresh-side
  // anchor. Pinned by lib/__tests__/auth.test.ts.
  if (profile.revoked_at) {
    const revokedAtMs = new Date(profile.revoked_at as string).getTime();
    if (Number.isFinite(revokedAtMs)) {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      const iat = accessToken ? decodeJwtIat(accessToken) : null;
      const revokedAtSec = Math.floor(revokedAtMs / 1000);
      if (iat == null || iat < revokedAtSec) {
        return null;
      }
    }
  }

  return {
    id: data.user.id,
    email: (profile.email as string) ?? data.user.email ?? "",
    role: profile.role as Role,
  };
}

/**
 * Assert that the caller is authenticated AND holds one of the listed
 * roles. Throws AuthError(401) when unauthenticated, AuthError(403)
 * when the role doesn't match.
 */
export async function requireRole(
  supabase: SupabaseClient,
  allowed: readonly Role[],
): Promise<SessionUser> {
  const user = await getCurrentUser(supabase);
  if (!user) {
    throw new AuthError(401, "Authentication required");
  }
  if (!allowed.includes(user.role)) {
    throw new AuthError(
      403,
      `Role '${user.role}' not permitted; requires one of: ${allowed.join(", ")}`,
    );
  }
  return user;
}

// Revocation lives in lib/auth-revoke.ts — it uses a direct Postgres
// connection (pg) and must never be reachable from the Edge middleware
// bundle. Import `signOutAuthUser` from "@/lib/auth-revoke" instead.

// ---------------------------------------------------------------------------
// Active-admin count.
//
// Both the /admin/users/[id]/role PATCH and /admin/users/[id]/revoke POST
// routes need to block operations that would leave the org with zero
// active admins. "Active" means role='admin' AND revoked_at IS NULL — a
// revoked admin cannot sign in and does not count. The M15-4 audit found
// a drift where /role PATCH was counting `role='admin'` only (without the
// revoked_at filter), which could let an operator demote the last *active*
// admin if a revoked admin existed on the table. Both call sites now go
// through this shared helper so the count definition cannot drift again.
//
// Returns a discriminated result so callers can distinguish "couldn't
// count" from "counted zero" without reading error codes. Service-role
// client, bypasses RLS.
// ---------------------------------------------------------------------------

export async function countActiveAdmins(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  const svc = getServiceRoleClient();
  const { count, error } = await svc
    .from("opollo_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .is("revoked_at", null);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, count: count ?? 0 };
}
