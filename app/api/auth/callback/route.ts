import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createRouteAuthClient } from "@/lib/auth";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// /api/auth/callback
//
// Auth-link landing handler. Called by:
//   - Magic-link emails (the invite flow in M2c-2 / M2d)
//   - Password-reset emails (M14-3)
//   - Any other Supabase-Auth-issued URL with a verifiable token
//
// Two link shapes are supported because Supabase emits both depending
// on project + email-template configuration:
//
//   1. PKCE: ?code=<uuid>           → exchangeCodeForSession(code)
//   2. OTP : ?token_hash=&type=...  → verifyOtp({ token_hash, type })
//
// The default Supabase password-reset / invite templates use
// `{{ .TokenHash }}` + `&type=recovery` (the OTP shape) unless the
// project is explicitly on the PKCE flow. Handling both keeps the
// callback robust to template / flow swaps without requiring a code
// redeploy alongside a Supabase config change. A callback that only
// handled PKCE silently failed every recovery click on the OTP shape
// — the user landed on /auth-error?reason=missing_code with no path
// forward.
//
// On success: cookies are set (via the SSR client's setAll callback)
// and we 302 to ?next= (sanitised) or /admin/sites.
// On failure: redirect to /auth-error with ?reason= for operator triage.
// ---------------------------------------------------------------------------

const VERIFY_TYPES: ReadonlySet<EmailOtpType> = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (VERIFY_TYPES as ReadonlySet<string>).has(value);
}

function safeNext(req: NextRequest, rawNext: string | null): string {
  // Only allow same-origin relative paths to survive as the redirect
  // target. Blocks open-redirect attacks where an invite link is
  // rewritten to ?next=https://evil.example.
  if (!rawNext) return "/admin/sites";
  if (!rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/admin/sites";
  }
  try {
    const u = new URL(rawNext, req.nextUrl.origin);
    if (u.origin !== req.nextUrl.origin) return "/admin/sites";
    return u.pathname + u.search;
  } catch {
    return "/admin/sites";
  }
}

function authErrorRedirect(
  req: NextRequest,
  reason: string,
): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = "/auth-error";
  url.search = `?reason=${reason}`;
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit("auth_callback", `ip:${getClientIp(req)}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const code = req.nextUrl.searchParams.get("code");
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const otpType = req.nextUrl.searchParams.get("type");
  const next = safeNext(req, req.nextUrl.searchParams.get("next"));

  if (!code && !tokenHash) {
    return authErrorRedirect(req, "missing_code");
  }

  const supabase = createRouteAuthClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return authErrorRedirect(req, "exchange_failed");
  } else if (tokenHash) {
    if (!isOtpType(otpType)) {
      return authErrorRedirect(req, "invalid_type");
    }
    const { error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash: tokenHash,
    });
    if (error) return authErrorRedirect(req, "verify_failed");
  }

  const dest = req.nextUrl.clone();
  dest.pathname = next;
  dest.search = "";
  return NextResponse.redirect(dest);
}
