import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { consume } from "@/lib/platform/magic-link";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /magic-link/login?token=<raw_token>
//
// Consumption route for passwordless login magic links.
// Flow:
//   1. Validate + consume the magic_links row.
//   2. Generate a Supabase-native one-time login URL for the user
//      (delegates session establishment to Supabase's /auth/v1/verify).
//   3. Redirect to the Supabase action link, which goes through
//      /auth/callback and establishes the session cookie.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rawToken = req.nextUrl.searchParams.get("token") ?? "";

  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_link", req.nextUrl.origin),
    );
  }

  // Consume the magic link (session TTL for login = 0; consumed_at is set
  // but session_expires_at stays null since login creates a real Supabase session)
  const result = await consume(rawToken);
  if (!result.valid) {
    logger.warn("magic_link.login.consume_failed", { reason: result.reason });
    return NextResponse.redirect(
      new URL(`/login?error=${result.reason}`, req.nextUrl.origin),
    );
  }

  const link = result.link;
  if (!link.email) {
    logger.error("magic_link.login.no_email", { link_id: link.id });
    return NextResponse.redirect(
      new URL("/login?error=invalid_link", req.nextUrl.origin),
    );
  }

  // Exchange our consumed magic link for a Supabase-native magic link.
  // Supabase handles session cookie creation; we just redirect to the
  // action_link it returns (which goes through /auth/v1/verify → /auth/callback).
  const svc = getServiceRoleClient();
  const { data: generated, error } =
    await svc.auth.admin.generateLink({
      type: "magiclink",
      email: link.email,
      options: {
        redirectTo: `${req.nextUrl.origin}/company`,
      },
    });

  if (error || !generated?.properties?.action_link) {
    logger.error("magic_link.login.generate_link_failed", {
      err: error?.message,
    });
    return NextResponse.redirect(
      new URL("/login?error=session_error", req.nextUrl.origin),
    );
  }

  return NextResponse.redirect(generated.properties.action_link);
}
