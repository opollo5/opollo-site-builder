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
// PKCE code-exchange handler. Called by:
//   - Magic-link emails (the invite flow in M2c-2 / M2d)
//   - Password-reset emails
//   - Any other Supabase-Auth-issued URL that carries `?code=<uuid>`
//
// On success: sets the auth cookies (via the SSR client's setAll
// callback) and 302-redirects to `?next=<path>` or /admin/sites.
// On failure: redirects to /auth-error, preserving `?reason=` for
// operator triage.
//
// No JSON body — this is a browser-navigated GET.
// ---------------------------------------------------------------------------

function safeNext(req: NextRequest, rawNext: string | null): string {
  // Only allow same-origin relative paths to survive as the redirect
  // target. Blocks open-redirect attacks where an invite link is
  // rewritten to ?next=https://evil.example.
  if (!rawNext) return "/admin/sites";
  if (!rawNext.startsWith("/") || rawNext.startsWith("//")) {
    return "/admin/sites";
  }
  try {
    // Round-trip through URL to normalise.
    const u = new URL(rawNext, req.nextUrl.origin);
    if (u.origin !== req.nextUrl.origin) return "/admin/sites";
    return u.pathname + u.search;
  } catch {
    return "/admin/sites";
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit("auth_callback", `ip:${getClientIp(req)}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const code = req.nextUrl.searchParams.get("code");
  const next = safeNext(req, req.nextUrl.searchParams.get("next"));

  if (!code) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth-error";
    url.search = "?reason=missing_code";
    return NextResponse.redirect(url);
  }

  const supabase = createRouteAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth-error";
    url.search = "?reason=exchange_failed";
    return NextResponse.redirect(url);
  }

  const dest = req.nextUrl.clone();
  dest.pathname = next;
  dest.search = "";
  return NextResponse.redirect(dest);
}
