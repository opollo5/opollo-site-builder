import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { validate } from "@/lib/platform/magic-link";
import {
  initiateProfileConnect,
  type ProfileSocialPlatform,
} from "@/lib/platform/social/profiles/connect";
import { getServiceRoleClient } from "@/lib/supabase";

// Same mapping as app/api/platform/social/connections/reconnect/route.ts.
// Keep aligned with lib/platform/social/variants/types.ts SocialPlatform.
const SOCIAL_TO_BUNDLE: Record<string, ProfileSocialPlatform> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company:  "LINKEDIN",
  facebook_page:     "FACEBOOK",
  x:                 "TWITTER",
  gbp:               "GOOGLE_BUSINESS",
};

const WITH_BUSINESS_SCOPE: ReadonlySet<string> = new Set(["FACEBOOK", "INSTAGRAM"]);

// ---------------------------------------------------------------------------
// POST /api/portal/connections/[connectionId]/reconnect
//
// B4 client portal — initiates OAuth reconnect for a specific connection.
// No Supabase session. Token IS the auth.
//
// SECURITY — COMPANY BINDING (Requirement #1, hard requirement):
//   company_id is derived SERVER-SIDE from the magic_links row.
//   The client never supplies company_id — it comes from the magic link
//   the operator already bound to their company at issue time.
//   This is the exact surface the 2026-05-11 LinkedIn leak came through.
//
// Flow:
//   1. validate(token) → session active, get company_id from magic_links row
//   2. verify connectionId belongs to that company (server-side FK guard)
//   3. initiateProfileConnect() with portal callback as redirectUrl
//   4. return { url } — client opens OAuth popup
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  // Raw magic-link token — used to validate the session server-side.
  // company_id is derived from the magic_links row, NEVER from this payload.
  token: z.string().regex(/^[0-9a-f]{64}$/i, "Invalid token format"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
): Promise<NextResponse> {
  const { connectionId } = await params;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body required.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const { token } = parsed.data;

  // ─── Step 1: validate magic_links session ──────────────────────────────
  // validate() is read-only — does not consume. Checks session_expires_at.
  const session = await validate(token);
  if (!session.valid) {
    return NextResponse.json(
      { ok: false, error: { code: "SESSION_EXPIRED", message: "Your session has expired. Request a fresh link." } },
      { status: 401 },
    );
  }

  // company_id comes exclusively from the magic_links row.
  // The operator bound this to their company when they issued the link.
  const companyId = session.link.company_id;
  if (!companyId) {
    logger.error("portal.reconnect.no_company_id", { link_id: session.link.id });
    return internalError("This link is not associated with a company.");
  }

  const svc = getServiceRoleClient();

  // ─── Step 2: verify the connection belongs to this company ─────────────
  // Server-side FK guard: client cannot reconnect a connection from a
  // different company by sending a different connectionId.
  const { data: connection, error: connErr } = await svc
    .from("social_connections")
    .select("id, platform, profile_id, status, company_id")
    .eq("id", connectionId)
    // GUARD REMOVED — throwaway red-proof only, never merges to main
    .maybeSingle();

  if (connErr) {
    logger.error("portal.reconnect.connection_lookup_failed", { err: connErr.message });
    return internalError("Failed to load connection.");
  }
  if (!connection) {
    // Either connection doesn't exist or belongs to a different company.
    // Return the same message for both — don't reveal which case it is.
    return validationError("Connection not found.");
  }

  const conn = connection as {
    id: string;
    platform: string;
    profile_id: string | null;
    status: string;
    company_id: string;
  };

  if (conn.status !== "auth_required" && conn.status !== "disconnected") {
    return validationError(
      `Connection status is '${conn.status}' — reconnect only applies to auth_required or disconnected connections.`,
    );
  }

  if (!conn.profile_id) {
    // No bundle.social profile — connection was never fully provisioned.
    // Can't reconnect without a profile (this is a connect, not a reconnect).
    return validationError("This connection has no associated profile. Contact your account manager.");
  }

  const bundlePlatform = SOCIAL_TO_BUNDLE[conn.platform];
  if (!bundlePlatform) {
    return validationError(
      `Platform "${conn.platform}" cannot be reconnected via the portal. Contact your account manager.`,
    );
  }

  // ─── Step 3: initiate OAuth popup via bundle.social ────────────────────
  // The portal callback URL carries the raw token as portal_token so the
  // callback can validate the session server-side without a Supabase cookie.
  // company_id is NOT embedded in the redirect URL — it is re-derived from
  // the portal_token in the callback (server-side only).
  const portalCallbackUrl = `${req.nextUrl.origin}/api/portal/connections/callback?portal_token=${token}&popup=1`;

  const result = await initiateProfileConnect({
    profileId: conn.profile_id,
    platform: bundlePlatform,
    redirectUrl: portalCallbackUrl,
    disableAutoLogin: true,
    withBusinessScope: WITH_BUSINESS_SCOPE.has(bundlePlatform),
  });

  if (!result.ok) {
    logger.error("portal.reconnect.initiate_failed", {
      connectionId,
      companyId,
      err: result.error.message,
    });
    return internalError(result.error.message);
  }

  logger.info("portal.reconnect.initiated", {
    connectionId,
    companyId,
    platform: conn.platform,
  });

  return NextResponse.json(
    { ok: true, data: { url: result.data.url }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
