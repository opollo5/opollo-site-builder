import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// M14-2 — canonical base URL for Supabase auth redirects.
//
// Every Supabase auth call that produces a link the user clicks (invite,
// password reset, magic-link sign-in, email change confirmation) needs a
// `redirectTo` / `emailRedirectTo` pointing at THIS app. If that URL is
// wrong — points at localhost from production, or points at a host not
// in the Supabase project's "Redirect URLs" allowlist — the user clicks
// the link and lands nowhere useful.
//
// The helper resolves the base URL in priority order:
//
//   1. NEXT_PUBLIC_SITE_URL env var (canonical override).
//      Set this in Vercel production + preview to pin the URL regardless
//      of what Host header an incoming request carries. This is the
//      production-safe choice — it's immune to Host header spoofing and
//      matches the value you have to register in the Supabase dashboard
//      anyway.
//
//   2. Request origin (fallback).
//      When no env var is set AND a Request is supplied, derive the base
//      from `req.nextUrl.origin` (Next) or the URL constructor. This keeps
//      local dev ergonomic (no .env.local edits needed) and works for
//      Vercel preview deploys without per-branch config.
//
//   3. Throw.
//      No env + no request = no safe way to know where the user should
//      land. Callers in that position (server actions, cron) must supply
//      the env var.
//
// The value is always returned without a trailing slash — callers append
// their own path with a leading slash.
// ---------------------------------------------------------------------------

export class AuthRedirectBaseUnavailable extends Error {
  constructor() {
    super(
      "Cannot resolve auth redirect base: NEXT_PUBLIC_SITE_URL is unset and no Request was provided.",
    );
    this.name = "AuthRedirectBaseUnavailable";
  }
}

function normalise(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("auth-redirect: empty URL");
  }
  // Use the URL constructor to reject malformed values loudly at call
  // time rather than silently producing a broken redirect.
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `auth-redirect: unsupported protocol ${parsed.protocol} (only http/https allowed)`,
    );
  }
  // Strip trailing slash so callers can always do `${base}/path`.
  return `${parsed.protocol}//${parsed.host}`;
}

let warnedHttpInProdOnce = false;

/**
 * Resolve the canonical base URL for Supabase auth redirects.
 *
 * Pass a Request when one is available (route handlers, middleware) so
 * the fallback path can read the origin. Server actions / cron handlers
 * that don't have a Request MUST set NEXT_PUBLIC_SITE_URL.
 *
 * Throws {@link AuthRedirectBaseUnavailable} when neither source is
 * available. Throws on malformed input.
 */
export function getAuthRedirectBase(req?: Request): string {
  const envValue = process.env.NEXT_PUBLIC_SITE_URL;
  if (envValue && envValue.trim().length > 0) {
    const base = normalise(envValue);
    if (
      process.env.NODE_ENV === "production" &&
      base.startsWith("http://") &&
      !warnedHttpInProdOnce
    ) {
      warnedHttpInProdOnce = true;
      logger.warn("auth-redirect: NEXT_PUBLIC_SITE_URL is http:// in production", {
        base,
      });
    }
    return base;
  }

  if (req) {
    // `req.nextUrl.origin` isn't on the plain Request type, but callers
    // in Next route handlers receive NextRequest which has it. We fall
    // back to parsing `req.url` so the helper works with either.
    const origin =
      (req as unknown as { nextUrl?: { origin?: string } }).nextUrl?.origin ??
      new URL(req.url).origin;
    return normalise(origin);
  }

  throw new AuthRedirectBaseUnavailable();
}

/**
 * Build a full auth-redirect URL by appending `path` to the resolved base.
 * `path` must start with `/`. Query string is preserved if present in `path`.
 */
export function buildAuthRedirectUrl(path: string, req?: Request): string {
  if (!path.startsWith("/")) {
    throw new Error(`auth-redirect: path must start with "/" (got ${path})`);
  }
  return `${getAuthRedirectBase(req)}${path}`;
}

/**
 * Test-only reset for the one-time prod-http warning latch.
 */
export function __resetAuthRedirectWarningsForTests(): void {
  warnedHttpInProdOnce = false;
}
