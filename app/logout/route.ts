import { NextResponse, type NextRequest } from "next/server";

import { createRouteAuthClient } from "@/lib/auth";

// ---------------------------------------------------------------------------
// /logout
//
// Signs the current user out via supabase.auth.signOut — the SSR client's
// setAll callback clears the auth cookies on the response, so the
// redirect carries valid Set-Cookie headers that invalidate the session
// at the browser. Then redirects to /login.
//
// POST is the primary caller (the "Sign out" button in app/admin/layout
// posts a form here). GET is supported as a fallback so operators can
// hit /logout in the address bar when the admin UI itself is broken.
// CSRF surface: an attacker can force a logout via a crafted link, but
// that is a UX nuisance, not a compromise — the session is destroyed
// cleanly and the victim lands on /login.
//
// signOut() is best-effort. If Supabase is down and the call throws, we
// still redirect so the user isn't stranded on /logout.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";

async function signOutAndRedirect(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = createRouteAuthClient();
    await supabase.auth.signOut();
  } catch {
    // Best-effort sign-out; fall through to the redirect regardless so
    // the caller always reaches /login.
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  // 303 See Other is the right status for POST→GET redirect. Browsers
  // respect it consistently; 302 is technically spec-ambiguous.
  const response = NextResponse.redirect(url, { status: 303 });

  // Clear the 2FA in-flight cookies. signOut() above clears the Supabase
  // session cookies via the SSR adapter; the 2FA cookies live outside
  // that adapter and have to be cleared here. Without this, a logout
  // mid-flow leaves opollo_2fa_pending set and the next /login →
  // signInWithPassword → /admin/sites navigation gets bounced back to
  // /login/check-email by middleware, looking like a stuck-login bug.
  for (const name of ["opollo_2fa_pending", "opollo_pending_device_id"]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(req);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return signOutAndRedirect(req);
}
