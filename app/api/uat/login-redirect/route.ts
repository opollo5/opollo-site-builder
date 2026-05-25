import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getServiceRoleClient } from "@/lib/supabase";
import { checkRateLimit, getClientIp, rateLimitExceeded } from "@/lib/rate-limit";
import { PENDING_2FA_COOKIE } from "@/lib/2fa/cookies";

// ---------------------------------------------------------------------------
// GET /api/uat/login-redirect
//
// One-click staging login for human testers. Steven visits this URL in his
// browser and lands on the target page fully authenticated with all stale
// 2FA cookies cleared.
//
// PRODUCTION GUARD: 404 when VERCEL_ENV === 'production' or the app is not
// running in a preview / development environment.
//
// Why this is needed instead of the /api/uat/sign-in route:
//   /api/uat/sign-in is designed for Playwright (API call, returns JSON).
//   This route is designed for a browser URL click: it sets auth cookies on
//   the 302 redirect response AND explicitly expires any stale
//   opollo_2fa_pending / opollo_pending_device_id cookies, which would
//   otherwise send the middleware into a redirect loop to /login/check-email
//   even after AUTH_2FA_ENABLED=false is set on Vercel.
//
// Usage:
//   1. Copy the URL printed by `npm run uat:login-url` (or build it manually)
//   2. Open it in any browser tab on the staging origin
//   3. You land on ?next= (default: /company/social/calendar) logged in
//
// Query params:
//   secret  — must match STAGING_UAT_SECRET (required)
//   next    — relative path to redirect to after login (optional)
//   email   — override UAT email (optional, defaults to STAGING_UAT_EMAIL)
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAllowedEnv(): boolean {
  const env = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV;
  const vercelEnv = process.env.VERCEL_ENV;
  return (
    env === "staging" ||
    env === "development" ||
    vercelEnv === "preview" ||
    vercelEnv === "development"
  );
}

const STALE_2FA_COOKIES = [PENDING_2FA_COOKIE, "opollo_pending_device_id"] as const;

function clearStale2faCookies(response: NextResponse): void {
  for (const name of STALE_2FA_COOKIES) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAllowedEnv()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { searchParams } = req.nextUrl;
  const secret = searchParams.get("secret");
  const rawNext = searchParams.get("next") ?? "/company/social/calendar";
  const emailOverride = searchParams.get("email");

  // Sanitise the redirect target to prevent open-redirect attacks.
  let nextPath = "/company/social/calendar";
  if (rawNext.startsWith("/") && !rawNext.startsWith("//")) {
    nextPath = rawNext;
  }

  const expectedSecret = process.env.STAGING_UAT_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "STAGING_UAT_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }
  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate-limit — same bucket as the general uat_sign_in route.
  const ip = getClientIp(req);
  const rl = await checkRateLimit("uat_sign_in", `ip:${ip}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const email =
    emailOverride ?? process.env.STAGING_UAT_EMAIL ?? "uat-bot@staging.opollo.com";
  const password = process.env.STAGING_UAT_PASSWORD;

  // Build the redirect response up front so we can write auth cookies +
  // stale-2FA-cookie clears onto it before returning.
  const redirectDest = new URL(nextPath, req.nextUrl.origin);
  const response = NextResponse.redirect(redirectDest);

  // Always expire stale 2FA cookies regardless of sign-in outcome.
  // The middleware checks opollo_2fa_pending independently of
  // AUTH_2FA_ENABLED, so a leftover cookie from a previous login attempt
  // traps the browser on /login/check-email even after the flag is off.
  clearStale2faCookies(response);

  if (password) {
    // Option A: password auth via SSR client that writes directly onto the
    // redirect response (not next/headers cookies(), which would be
    // detached from this NextResponse object).
    const supabase = createServerClient(
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      {
        cookies: {
          getAll() {
            return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options ?? {});
            });
          },
        },
      },
    );

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!signInError) {
      return response;
    }

    // Password auth failed — fall through to Option B.
  }

  // Option B: generate a magic-link token via admin API and exchange it.
  // Used when STAGING_UAT_PASSWORD is unset or wrong. The token exchange
  // happens server-side, so the browser receives auth cookies directly on
  // the redirect response rather than being sent through a Supabase redirect.
  const adminClient = getServiceRoleClient();
  const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json(
      {
        error:
          "Both password auth and magic-link generation failed. " +
          (linkError ? linkError.message : "No hashed_token returned."),
      },
      { status: 500 },
    );
  }

  const supabase = createServerClient(
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return req.cookies.getAll().map((c) => ({ name: c.name, value: c.value }));
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options ?? {});
          });
        },
      },
    },
  );

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });

  if (verifyError) {
    return NextResponse.json(
      { error: "Magic-link token exchange failed: " + verifyError.message },
      { status: 500 },
    );
  }

  return response;
}
