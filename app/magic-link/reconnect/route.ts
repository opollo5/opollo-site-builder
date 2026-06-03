import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { consume } from "@/lib/platform/magic-link";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /magic-link/reconnect?token=<raw_token>
//
// Consumption route for social-connection reconnect magic links.
// Flow:
//   1. Validate + consume the magic_links row.
//   2. Look up the connection referenced by subject_id.
//   3. Redirect to the interactive reconnect OAuth start
//      (/api/platform/social/connections/reconnect) via a POST form or
//      by redirecting to a page that triggers the OAuth popup.
//
// Note: the full reconnect OAuth requires an authenticated session (editor+).
// If the requesting user has no session they will be redirected to login first
// with ?next pointing back here. The B4 client-portal work extends this to
// support sessionless clients.
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

  const result = await consume(rawToken);
  if (!result.valid) {
    logger.warn("magic_link.reconnect.consume_failed", { reason: result.reason });
    return NextResponse.redirect(
      new URL(`/login?error=${result.reason}`, req.nextUrl.origin),
    );
  }

  const link = result.link;
  if (!link.subject_id || link.subject_type !== "social_connection") {
    logger.error("magic_link.reconnect.invalid_subject", {
      subject_type: link.subject_type,
      link_id: link.id,
    });
    return NextResponse.redirect(
      new URL("/login?error=invalid_link", req.nextUrl.origin),
    );
  }

  // Look up the connection to surface the correct company context
  const svc = getServiceRoleClient();
  const { data: connection } = await svc
    .from("social_connections")
    .select("id, company_id")
    .eq("id", link.subject_id)
    .maybeSingle();

  if (!connection) {
    return NextResponse.redirect(
      new URL("/login?error=invalid_link", req.nextUrl.origin),
    );
  }

  // B4 client portal — redirect to the sessionless portal page.
  // The raw token is passed so the portal can validate the magic_links session.
  // company_id is derived SERVER-SIDE from the magic_links row in the portal page;
  // it is not embedded in this redirect URL (client never supplies company_id).
  const portalUrl = new URL(
    `/portal?token=${rawToken}`,
    req.nextUrl.origin,
  );
  return NextResponse.redirect(portalUrl);
}
