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

export type Role = "admin" | "operator" | "viewer";

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
// Identity readers — ALWAYS server-verified via getUser().
// ---------------------------------------------------------------------------

/**
 * Server-verify the caller's JWT with GoTrue and look up their
 * opollo_users role. Returns null when there's no authenticated user or
 * when the JWT is invalid / revoked. Never uses getSession() — that
 * variant decodes the cookie locally and would keep accepting revoked
 * tokens until they expire naturally.
 */
export async function getCurrentUser(
  supabase: SupabaseClient,
): Promise<SessionUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Role lookup goes through service-role — RLS would otherwise filter
  // the row to auth.uid() OR admin, which is fine for self-read but
  // brittle across runtimes. Service-role is identical to what the
  // M2a trigger uses when promoting the first admin.
  const svc = getServiceRoleClient();
  const { data: profile, error: profileErr } = await svc
    .from("opollo_users")
    .select("role,email")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileErr || !profile) return null;

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

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

/**
 * Revoke every session for a user, by user_id. Called by M2d on role
 * promotion/demotion and by M2c-3's emergency reset-role route.
 *
 * Uses GoTrue's admin logout endpoint
 * (`POST /auth/v1/admin/users/:id/logout`) because the JS SDK's
 * `auth.admin.signOut(jwt, scope)` requires a JWT and we only have the
 * user_id at role-change time. The endpoint is service-role-gated and
 * returns 204 on success.
 *
 * Post-condition (pinned by auth.test.ts): any JWT previously issued
 * for this user fails `supabase.auth.getUser()` on the NEXT request —
 * not after the JWT's natural TTL.
 */
export async function signOutAuthUser(userId: string): Promise<void> {
  const url = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const res = await fetch(`${url}/auth/v1/admin/users/${userId}/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
  });

  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `signOutAuthUser(${userId}): HTTP ${res.status}${body ? ` — ${body}` : ""}`,
    );
  }
}
