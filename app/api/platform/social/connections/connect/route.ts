import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, invalidState, internalError, notFound } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { preConnectGhostCheck } from "@/lib/platform/social/connections/reconcile";
import { getProfileById } from "@/lib/platform/social/profiles";
import {
  initiateProfileConnect,
  type ProfileSocialPlatform,
} from "@/lib/platform/social/profiles/connect";
import { getOrCreateBundleSocialTeamForProfile } from "@/lib/platform/social/profiles/provision-team";

// ---------------------------------------------------------------------------
// BSP-6-CUSTOMER — POST /api/platform/social/connections/connect
//
// Customer-facing per-platform direct OAuth connect.
//
// Body: { company_id: uuid, profile_id: uuid, platform: ProfileSocialPlatform }
//
// Returns { ok: true, data: { url: string } } — caller opens in a popup.
// The popup completes against /api/platform/social/connections/callback
// (?popup=1) which sends a postMessage + window.close() back to the parent.
//
// Gate: canDo("manage_connections", company_id) — admin-only.
//
// Flags:
//   disableAutoLogin: always true — avoids silent re-auth of an existing
//     browser session on Facebook / Instagram / TikTok when adding a
//     second account.
//   withBusinessScope: true for FACEBOOK and INSTAGRAM — adds
//     business_management, ads_management, ads_read scopes needed for
//     page management and analytics.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_ENUM = z.enum([
  "TIKTOK",
  "YOUTUBE",
  "INSTAGRAM",
  "FACEBOOK",
  "TWITTER",
  "THREADS",
  "LINKEDIN",
  "PINTEREST",
  "REDDIT",
  "MASTODON",
  "DISCORD",
  "SLACK",
  "BLUESKY",
  "GOOGLE_BUSINESS",
]);

const PostBodySchema = z.object({
  company_id: dbUuid(),
  profile_id: dbUuid(),
  platform: PLATFORM_ENUM,
});

const WITH_BUSINESS_SCOPE_PLATFORMS: ReadonlySet<string> = new Set([
  "FACEBOOK",
  "INSTAGRAM",
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, profile_id: uuid, platform: ProfileSocialPlatform }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(
    parsed.data.company_id,
    "manage_connections",
  );
  if (gate.kind === "deny") return gate.response;

  // BSP-10: cross-tenant profile_id smuggling guard.
  // An admin authenticated against company A must not be able to pass a
  // profile_id belonging to company B — that would initiate OAuth against
  // B's bundle.social team. The gate above only checks company_id; we must
  // also verify the profile belongs to the same company.
  const profile = await getProfileById(parsed.data.profile_id);
  if (!profile) return notFound("Profile not found.");
  if (profile.company_id !== parsed.data.company_id) {
    logger.warn("social.connections.connect.profile_smuggling_attempt", {
      companyId: parsed.data.company_id,
      profileId: parsed.data.profile_id,
      profileCompanyId: profile.company_id,
      userId: gate.userId,
    });
    return notFound("Profile not found in this company.");
  }

  // L1 pre-connect ghost check (failsafe, 2026-05-12). Before opening
  // OAuth, ask bundle.social whether the team already holds an account
  // for this platform.
  //   - clean → proceed as today
  //   - ghost_cleared → BS had a ghost; auto-disconnected; proceed
  //   - db_match → an existing DB row matches; tell the UI to surface it
  //   - error → defensive: proceed; the connect step will surface
  //     bundle.social's own error if it still rejects
  try {
    const teamId = await getOrCreateBundleSocialTeamForProfile(parsed.data.profile_id);
    const pre = await preConnectGhostCheck({
      teamId,
      platform: parsed.data.platform as ProfileSocialPlatform,
      actorId: gate.userId,
    });
    if (pre.kind === "ghost_cleared") {
      logger.info("social.connections.connect.pre_ghost_cleared", {
        company_id: parsed.data.company_id,
        profile_id: parsed.data.profile_id,
        platform: parsed.data.platform,
        team_id: teamId,
        bundle_account_id: pre.bundle_account_id,
      });
    } else if (pre.kind === "db_match") {
      logger.info("social.connections.connect.pre_db_match", {
        company_id: parsed.data.company_id,
        platform: parsed.data.platform,
        existing_connection_id: pre.existing_connection_id,
      });
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "ALREADY_CONNECTED",
            message: `${parsed.data.platform} is already connected on this profile. Disconnect the existing account first.`,
            existing_connection_id: pre.existing_connection_id,
            existing_company_id: pre.existing_company_id,
            existing_display_name: pre.existing_display_name,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 409 },
      );
    } else if (pre.kind === "error") {
      logger.warn("social.connections.connect.pre_check_failed", {
        company_id: parsed.data.company_id,
        platform: parsed.data.platform,
        message: pre.message,
      });
      // Continue to initiateProfileConnect anyway — the SDK will surface
      // a real "already connected" error if there's genuinely a clash.
    }
  } catch (err) {
    logger.warn("social.connections.connect.pre_check_setup_failed", {
      company_id: parsed.data.company_id,
      profile_id: parsed.data.profile_id,
      err: err instanceof Error ? err.message : String(err),
    });
    // Fall through — the connect path will handle its own provisioning.
  }

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    new URL(req.url).origin;
  const redirectUrl =
    `${origin}/api/platform/social/connections/callback` +
    `?company_id=${encodeURIComponent(parsed.data.company_id)}&popup=1`;

  const result = await initiateProfileConnect({
    profileId: parsed.data.profile_id,
    platform: parsed.data.platform as ProfileSocialPlatform,
    redirectUrl,
    disableAutoLogin: true,
    withBusinessScope: WITH_BUSINESS_SCOPE_PLATFORMS.has(parsed.data.platform),
  });

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "VALIDATION_FAILED") return validationError(message);
    if (code === "RECEIVER_NOT_CONFIGURED") return invalidState(message);
    // bundle.social returned a 4xx (e.g. "this platform is already connected
    // to this team", or a flag the platform doesn't support). 500 was
    // misleading and made the surface look broken to the operator. 409
    // with bundle.social's own message is more actionable.
    if (code === "UPSTREAM_REJECTED") return invalidState(message);
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
