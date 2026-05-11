import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, notFound, invalidState, internalError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  initiateProfileConnect,
  type ProfileSocialPlatform,
} from "@/lib/platform/social/profiles/connect";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/connections/reconnect — S8 self-service reconnect.
//
// Lowers the permission bar for reconnecting an *existing* disconnected or
// auth_required social connection from admin-only (manage_connections) to
// editor+ (reconnect_connection). Creating new connections, deleting, and
// syncing remain admin-only via the /connect and /sync routes.
//
// Body: { company_id: uuid, connection_id: uuid }
//
// Flow:
//   1. Gate: reconnect_connection (editor+).
//   2. Validate: connection exists for this company AND is reconnectable
//      (status = auth_required | disconnected). Returns 409 otherwise.
//   3. Resolve profile_id from the connection. Returns 409 if unset
//      (sync has not yet attributed this connection to a profile —
//      run a manual sync first).
//   4. Map internal SocialPlatform → ProfileSocialPlatform (bundle.social enum).
//   5. Call initiateProfileConnect (direct OAuth, not portal link).
//   6. Return { url } — caller opens in popup.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  company_id: dbUuid(),
  connection_id: z.string().uuid(),
});

const RECONNECTABLE_STATUSES = ["auth_required", "disconnected"] as const;

// Maps our internal SocialPlatform enum to bundle.social's ProfileSocialPlatform.
// Keep aligned with lib/platform/social/variants/types.ts SocialPlatform definition.
const SOCIAL_TO_BUNDLE: Record<string, ProfileSocialPlatform> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

const WITH_BUSINESS_SCOPE_PLATFORMS: ReadonlySet<string> = new Set([
  "FACEBOOK",
  "INSTAGRAM",
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { company_id: uuid, connection_id: uuid }.");
  }

  const { company_id: companyId, connection_id: connectionId } = parsed.data;

  const gate = await requireCanDoForApi(companyId, "reconnect_connection");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();
  const { data: conn, error: connErr } = await svc
    .from("social_connections")
    .select("id, company_id, profile_id, platform, status")
    .eq("id", connectionId)
    .eq("company_id", companyId)
    .single();

  if (connErr || !conn) {
    return notFound("Connection not found or does not belong to this company.");
  }

  const status = conn.status as string;
  if (
    !RECONNECTABLE_STATUSES.includes(
      status as (typeof RECONNECTABLE_STATUSES)[number],
    )
  ) {
    return invalidState(`Connection is currently "${status}" and does not need reconnecting.`);
  }

  const profileId = conn.profile_id as string | null;
  if (!profileId) {
    return invalidState(
      "This connection has not yet been attributed to a social profile. " +
      "Run a sync to resolve attribution, then retry.",
    );
  }

  const bundlePlatform = SOCIAL_TO_BUNDLE[conn.platform as string];
  if (!bundlePlatform) {
    return invalidState(
      `Platform "${conn.platform}" cannot be reconnected via direct OAuth. Contact support.`,
    );
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    new URL(req.url).origin;
  const redirectUrl =
    `${origin}/api/platform/social/connections/callback` +
    `?company_id=${encodeURIComponent(companyId)}&popup=1`;

  logger.info("social.connections.reconnect.start", {
    companyId,
    connectionId,
    platform: conn.platform,
    profileId,
    userId: gate.userId,
  });

  const result = await initiateProfileConnect({
    profileId,
    platform: bundlePlatform,
    redirectUrl,
    disableAutoLogin: true,
    withBusinessScope: WITH_BUSINESS_SCOPE_PLATFORMS.has(bundlePlatform),
  });

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "VALIDATION_FAILED") return validationError(message);
    if (code === "RECEIVER_NOT_CONFIGURED") return invalidState(message);
    return internalError(message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { url: result.data.url },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
