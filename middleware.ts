import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareAuthClient } from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";

// ---------------------------------------------------------------------------
// Edge-runtime middleware.
//
// Two gates, keyed off FEATURE_SUPABASE_AUTH:
//
//   FEATURE_SUPABASE_AUTH unset / "false" / "0"
//     → Legacy HTTP-Basic path. Byte-identical to the pre-M2c behaviour.
//       Proves backward compat for anyone still running this flag off.
//
//   FEATURE_SUPABASE_AUTH = "true" | "1"
//     → Supabase Auth path. BINARY: a session-read failure here fails
//       closed (500 / /auth-error) — no silent fall-through to Basic Auth.
//
// The DB-backed kill switch (opollo_config.auth_kill_switch = 'on') is
// the runtime override: when ON, we ignore the env flag and behave as
// if FEATURE_SUPABASE_AUTH were off. That's the break-glass path M2c-3
// ships; see lib/auth-kill-switch.ts for the rationale.
//
// Runtime: Edge (default). @supabase/ssr's createServerClient is
// fetch-based and runs on Edge without a runtime directive. The
// kill-switch read also goes through supabase-js (fetch-based, no
// pg-protocol, no Node APIs). No `export const runtime = 'nodejs'`
// needed.
// ---------------------------------------------------------------------------

function isFeatureOn(): boolean {
  const v = process.env.FEATURE_SUPABASE_AUTH;
  return v === "true" || v === "1";
}

function decodeBase64(value: string): string {
  try {
    return atob(value);
  } catch {
    return "";
  }
}

// Paths that must remain reachable without a Supabase session under the
// flag-on mode. Anything not matched here needs an authenticated user.
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/logout",
  "/auth-error",
  "/api/auth/callback",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Static-asset guards come from the matcher below, but we keep this
  // belt-and-suspenders so a future matcher change doesn't accidentally
  // gate /_next.
  if (pathname.startsWith("/_next/")) return true;
  return false;
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

// ---------------------------------------------------------------------------
// Basic Auth (legacy path, also used when kill-switch is ON)
// ---------------------------------------------------------------------------

function basicAuthGate(req: NextRequest): NextResponse {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  if (!user || !pass) {
    return NextResponse.next();
  }

  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = decodeBase64(encoded);
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const u = decoded.slice(0, sep);
        const p = decoded.slice(sep + 1);
        if (u === user && p === pass) {
          return NextResponse.next();
        }
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="opollo-site-builder", charset="UTF-8"',
    },
  });
}

// ---------------------------------------------------------------------------
// Supabase Auth gate (flag on)
// ---------------------------------------------------------------------------

function unauthenticatedResponse(req: NextRequest): NextResponse {
  if (isApiPath(req.nextUrl.pathname)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 401 },
    );
  }
  const url = req.nextUrl.clone();
  const next = url.pathname + url.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

function authErrorResponse(req: NextRequest): NextResponse {
  // Binary-auth contract: any failure in the Supabase path must fail
  // closed. 500 for /api callers (they can retry / surface to the
  // user), static /auth-error for HTML callers.
  if (isApiPath(req.nextUrl.pathname)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "AUTH_UNAVAILABLE",
          message: "Authentication service unavailable",
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/auth-error";
  url.search = "";
  return NextResponse.redirect(url);
}

async function supabaseAuthGate(req: NextRequest): Promise<NextResponse> {
  if (isPublicPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  let supabase;
  let response: NextResponse;
  try {
    ({ supabase, response } = createMiddlewareAuthClient(req));
  } catch {
    return authErrorResponse(req);
  }

  let userId: string | null = null;
  try {
    // getUser() — server-verified against GoTrue. Never getSession():
    // that would keep accepting revoked tokens until the JWT's natural
    // exp. The revocation regression test in lib/__tests__/auth.test.ts
    // pins this.
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // Invalid / expired / revoked JWT is a normal no-session state —
      // not a "service down" error. Fall through to the unauthenticated
      // redirect rather than the binary fail-closed /auth-error.
      userId = null;
    } else {
      userId = data.user?.id ?? null;
    }
  } catch {
    // Exception (network blip, malformed SSR client state, etc) is
    // the binary-failure path: fail closed, never fall through.
    return authErrorResponse(req);
  }

  if (!userId) {
    return unauthenticatedResponse(req);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!isFeatureOn()) {
    return basicAuthGate(req);
  }

  // Flag is on — check kill switch. If ON, break-glass to legacy Basic
  // Auth path. The 5s cache in isAuthKillSwitchOn absorbs the per-
  // request cost.
  let killSwitch = false;
  try {
    killSwitch = await isAuthKillSwitchOn();
  } catch {
    killSwitch = false;
  }
  if (killSwitch) {
    return basicAuthGate(req);
  }

  return supabaseAuthGate(req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
