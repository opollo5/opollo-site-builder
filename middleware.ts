import { NextResponse, type NextRequest } from "next/server";
import { createMiddlewareAuthClient } from "@/lib/auth";
import { isAuthKillSwitchOn } from "@/lib/auth-kill-switch";
import {
  applySecurityHeaders,
  ensureRequestId,
} from "@/lib/security-headers";

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
//
// /api/auth/* is a prefix — every auth endpoint (login, callback, and
// anything M2d adds) has to be callable pre-session. The explicit set
// below covers the top-level HTML pages that aren't under /api/auth/.
//
// /api/emergency bypasses the gate entirely: it's the break-glass hatch
// for when Supabase Auth itself is down, and its own OPOLLO_EMERGENCY_KEY
// check is the authentication for that route. See
// app/api/emergency/route.ts for the rationale.
const PUBLIC_PATHS = new Set<string>([
  "/login",
  "/logout",
  "/auth-error",
  "/api/emergency",
  // Health endpoint: must be reachable without a session so external
  // monitors (Uptime Robot, Vercel, etc.) can probe it. The endpoint
  // itself doesn't expose sensitive data — just connectivity + build
  // info. See app/api/health/route.ts.
  "/api/health",
  // M14-3 password-reset surfaces. Both are reachable without a
  // session — /auth/forgot-password is the entry form, and
  // /auth/reset-password decides server-side whether to render the
  // form (recovery session present) or the "link expired" state
  // (no session). The API counterparts under /api/auth/* are already
  // covered by the prefix check below.
  "/auth/forgot-password",
  "/auth/reset-password",
  // /auth/callback — client-side companion to /api/auth/callback that
  // handles Supabase implicit-flow links (#access_token=... in the URL
  // fragment). Reachable without a session because the whole point is
  // to MINT the session from the fragment.
  "/auth/callback",
  // /auth/approve — 2FA email-approval landing page. The token IS the
  // auth (server-component validates the random 32-byte token via a
  // SHA-256 lookup against login_challenges.token_hash). The page must
  // be reachable from any device, including ones with no Supabase
  // session — the whole point of email approval is that the operator
  // can click from a phone, hardware key, etc. Without this entry the
  // middleware bounced unauthenticated callers to /login, breaking
  // cross-device approval.
  "/auth/approve",
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // All /api/auth/* endpoints (login, logout-not-applicable-here,
  // callback, future invite/reset routes) are by definition pre-session.
  if (pathname.startsWith("/api/auth/")) return true;
  // /api/cron/* carries its own CRON_SECRET check; Supabase Auth isn't
  // involved. Required so the Vercel cron tick can reach the worker
  // endpoint without a session.
  if (pathname.startsWith("/api/cron/")) return true;
  // /api/ops/* runs its own admin-OR-emergency-key auth. The
  // emergency-key path exists so verification works even if Supabase
  // Auth is the thing being debugged — we can't route the probe
  // through the auth layer we're trying to verify.
  if (pathname.startsWith("/api/ops/")) return true;
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

  // Health endpoint must reach monitors without a password. The endpoint
  // itself exposes only connectivity + build info. Mirrors the
  // isPublicPath check in the Supabase Auth gate.
  if (req.nextUrl.pathname === "/api/health") {
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

  // AUTH-FOUNDATION P4.2 — 2FA-pending gate. When the login server
  // action issues an email-approval challenge, it sets the
  // opollo_2fa_pending cookie. Until complete-login clears it, every
  // navigation (other than the check-email + approve pages + their
  // APIs) bounces back to /login/check-email so the operator can't
  // reach admin surfaces with a half-authenticated session.
  //
  // The cookie value is signed; full HMAC validation lives on the
  // page/API consumers. Middleware just checks presence + redirects —
  // a forged cookie still blocks the attacker, just at a different
  // page (the check-email page would 404 the lookup).
  const pending2faCookie = req.cookies.get("opollo_2fa_pending")?.value;
  if (pending2faCookie) {
    const path = req.nextUrl.pathname;
    const allowedDuringPending =
      path === "/login/check-email" ||
      path === "/logout" ||
      path.startsWith("/api/auth/") ||
      path.startsWith("/_next/");
    // /auth/approve is now in PUBLIC_PATHS and short-circuits before
    // here; listing it again would be dead code.
    if (!allowedDuringPending) {
      const url = req.nextUrl.clone();
      url.pathname = "/login/check-email";
      // Preserve any pre-existing challenge_id query param through
      // the redirect; the page also reads the cookie as the source of
      // truth so this is just for tab consistency.
      return NextResponse.redirect(url);
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const requestId = ensureRequestId(req);

  let response: NextResponse;
  if (!isFeatureOn()) {
    response = basicAuthGate(req);
  } else {
    // Flag is on — check kill switch. If ON, break-glass to legacy Basic
    // Auth path. The 5s cache in isAuthKillSwitchOn absorbs the per-
    // request cost.
    let killSwitch = false;
    try {
      killSwitch = await isAuthKillSwitchOn();
    } catch {
      killSwitch = false;
    }
    response = killSwitch
      ? basicAuthGate(req)
      : await supabaseAuthGate(req);
  }

  return applySecurityHeaders(response, requestId);
}

export const config = {
  // Two patterns instead of one. The single `/((?!...).*)` pattern the
  // initial M2c middleware shipped does NOT match the bare root path
  // `/` in Next.js 14 — the `.*` is zero-or-more but path-to-regexp
  // compiles the resulting group to require at least one character
  // after the leading slash. In production that left `/` (the chat
  // builder) completely ungated under FEATURE_SUPABASE_AUTH=true:
  // unauthenticated sessions could reach the whole app root while
  // `/admin/*` correctly redirected. Splitting into an explicit `/`
  // entry plus a `.+` pattern for everything else closes the gap
  // without regressing the static-asset exclusions.
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico).+)",
  ],
};
