import type { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Security headers + request-ID propagation applied by middleware.ts on
// every response.
//
// Split from middleware.ts so the header policy can be unit-tested in
// isolation (middleware itself wires Supabase Auth and is awkward to
// call in a vitest process).
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function generateRequestId(): string {
  // Edge runtime has globalThis.crypto.randomUUID. Fall back for nodejs
  // runtimes that might not expose it (older versions).
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // RFC 4122 v4 fallback using getRandomValues.
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

// Propagate an incoming x-request-id when it's well-formed; generate a
// fresh UUIDv4 otherwise. "Well-formed" = canonical UUID. We reject any
// other shape to prevent log injection (a client shouldn't be able to
// put arbitrary text into our log stream via the request_id field).
export function ensureRequestId(req: NextRequest): string {
  const incoming = req.headers.get("x-request-id");
  if (incoming && UUID_RE.test(incoming)) return incoming;
  return generateRequestId();
}

// Header policy.
//
// CSP is shipped in Report-Only mode for now. Enforcing a tight policy
// against Next.js 14 App Router requires per-request nonce injection
// (middleware → next/headers → inline <script nonce> in templates). That
// migration is scoped as follow-up. Shipping Report-Only first lets us
// collect violation telemetry on real traffic, iterate the policy, and
// flip to enforce once it's clean. Report endpoint is deferred (blocked
// on observability provisioning) — for now the CSP runs policy-only and
// violations appear in the browser console.
//
// The enforced headers (X-Frame-Options, X-Content-Type-Options,
// Referrer-Policy, Permissions-Policy, Strict-Transport-Security,
// X-DNS-Prefetch-Control) are all safe to apply universally: none of
// them break Next.js App Router or the WordPress iframe preview (which
// is outbound, not inbound — we don't host iframes, we embed them).
const ENFORCED_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()",
  "X-DNS-Prefetch-Control": "on",
  // HSTS: 2 years + subdomains + preload eligible. Only emitted when
  // the request came in over HTTPS (see applySecurityHeaders) — sending
  // HSTS on plain HTTP is a no-op per spec but some scanners flag it.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
});

function buildReportOnlyCsp(): string {
  const wpOrigin = process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL ?? "";
  const supabaseOrigin = process.env.SUPABASE_URL ?? "";
  // External API hosts called from server routes (image generation +
  // compositing). All three are HTTPS-only; the CSP source list is
  // explicit-host so a typoed env var or rogue dependency can't reach a
  // different origin.
  const connectSources = [
    "'self'",
    supabaseOrigin,
    wpOrigin,
    "https://api.ideogram.ai",
    "https://api.bannerbear.com",
    "https://api.placid.app",
  ]
    .filter(Boolean)
    .join(" ");
  // 'unsafe-inline' for style-src: shadcn/Radix components inject inline
  // style attributes for positioning (popovers, tooltips). Migrating to
  // hashes / nonces is a follow-up.
  // 'unsafe-inline' + 'unsafe-eval' for script-src: Next.js App Router
  // emits inline hydration scripts per page. Nonces are the enforce-mode
  // migration path.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    wpOrigin ? `frame-src ${wpOrigin}` : "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function applySecurityHeaders(
  response: NextResponse,
  requestId: string,
): NextResponse {
  for (const [name, value] of Object.entries(ENFORCED_HEADERS)) {
    response.headers.set(name, value);
  }
  response.headers.set("Content-Security-Policy-Report-Only", buildReportOnlyCsp());
  response.headers.set("x-request-id", requestId);
  return response;
}

// Test hook.
export const __internal = {
  buildReportOnlyCsp,
  generateRequestId,
  ENFORCED_HEADERS,
};
