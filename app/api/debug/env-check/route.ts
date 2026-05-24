import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// GET /api/debug/env-check
//
// Staging/dev-only diagnostic endpoint that surfaces which Supabase project
// this deployment is connected to. Lets the UAT harness (and operators)
// confirm at runtime that a staging deploy is NOT using production Supabase.
//
// PRODUCTION GUARD: returns 404 when VERCEL_ENV === 'production'.
// This endpoint must never leak deployment details from production.
//
// No auth required — read-only, no secrets exposed.
// Allow-listed in middleware PUBLIC_PATHS.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractProjectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  const match = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

export async function GET(): Promise<NextResponse> {
  // Hard production guard — this endpoint must not be reachable in production.
  if (process.env.VERCEL_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? undefined;

  return NextResponse.json({
    app_env: process.env.APP_ENV ?? null,
    vercel_env: process.env.VERCEL_ENV ?? "local",
    supabase_url: supabaseUrl ?? null,
    has_service_role_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    project_ref_derived_from_url: extractProjectRef(supabaseUrl),
    build_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
  });
}
