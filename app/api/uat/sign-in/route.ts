import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteAuthClient } from "@/lib/auth";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/uat/sign-in
//
// UAT harness sign-in bypass. Authenticates a ghost user by email and
// returns a Supabase session (access_token + refresh_token). The SSR
// cookie adapter also writes the session cookies onto the response, so
// Playwright can capture them via Set-Cookie headers.
//
// PRODUCTION GUARD: returns 404 when VERCEL_ENV === 'production' or the
// app is not running in staging/development/preview. This endpoint must
// never be reachable in a production deployment.
//
// AUTH: Bearer token in Authorization header must match STAGING_UAT_SECRET.
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Hard environment guard — returns 404 in production
  if (!isAllowedEnv()) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Bearer token auth
  const secret = process.env.STAGING_UAT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STAGING_UAT_SECRET not configured on this deployment" },
      { status: 500 },
    );
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit: 100 req per 5 min per IP (cosmetic, staging only)
  const ip = getClientIp(req);
  const rl = await checkRateLimit("uat_sign_in", `ip:${ip}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  // Parse body
  let email: string;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (typeof body.email !== "string" || !body.email) {
      throw new Error("email required");
    }
    email = body.email;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body: { email: string } required" },
      { status: 400 },
    );
  }

  // Confirm the user exists via admin client.
  // Use NEXT_PUBLIC_SUPABASE_URL because staging Vercel env may have
  // SUPABASE_URL pointing to production while NEXT_PUBLIC_SUPABASE_URL
  // correctly targets the staging project.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Supabase admin credentials not configured" },
      { status: 500 },
    );
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: usersData, error: listError } =
    await adminClient.auth.admin.listUsers({ perPage: 1000 });
  if (listError) {
    return NextResponse.json(
      { error: "Failed to look up user: " + listError.message },
      { status: 500 },
    );
  }
  const targetUser = usersData.users.find((u) => u.email === email);
  if (!targetUser) {
    return NextResponse.json(
      { error: "User not found: " + email },
      { status: 404 },
    );
  }

  // Option A: password auth via SSR route client (sets session cookies on
  // the response so Playwright captures them from Set-Cookie headers)
  const password = process.env.STAGING_UAT_PASSWORD;
  const supabase = createRouteAuthClient();

  if (password) {
    const { data: signInData, error: signInError } =
      await supabase.auth.signInWithPassword({ email, password });
    if (!signInError && signInData.session) {
      return NextResponse.json({
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
        expires_at:
          signInData.session.expires_at ??
          Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: signInData.user.id,
          email: signInData.user.email ?? email,
          role: signInData.user.role ?? "authenticated",
        },
      });
    }
  }

  // Option B: generate a magic link via admin API and exchange the token
  const { data: linkData, error: linkError } =
    await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json(
      {
        error:
          "Failed to generate sign-in link" +
          (linkError ? ": " + linkError.message : ""),
      },
      { status: 500 },
    );
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyError) {
    return NextResponse.json(
      { error: "Token exchange failed: " + verifyError.message },
      { status: 500 },
    );
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) {
    return NextResponse.json(
      { error: "No session established after token exchange" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
    expires_at:
      sessionData.session.expires_at ??
      Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: sessionData.session.user.id,
      email: sessionData.session.user.email ?? email,
      role: sessionData.session.user.role ?? "authenticated",
    },
  });
}
