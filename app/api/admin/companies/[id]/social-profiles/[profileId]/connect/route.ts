import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  internalError,
  invalidState,
  notFound,
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { getProfileById } from "@/lib/platform/social/profiles";
import {
  initiateProfileConnect,
  type ProfileSocialPlatform,
} from "@/lib/platform/social/profiles/connect";

// ---------------------------------------------------------------------------
// BSP-6 — POST /api/admin/companies/[id]/social-profiles/[profileId]/connect
//
// Body: { platform: <bundle.social platform enum>, disable_auto_login?: boolean }
// Response: { ok: true, data: { url, team_id } }
//
// Operator-only (super_admin or admin). Lazily provisions the profile's
// bundle.social team via getOrCreateBundleSocialTeamForProfile (BSP-2-style
// race-safe path). Returns the OAuth URL the client opens in a popup.
// The popup completes against the existing bundle-connect callback at
// /api/platform/social/connections/callback.
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

const ConnectSchema = z.object({
  platform: PLATFORM_ENUM,
  disable_auto_login: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; profileId: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;
  const profileCheck = validateUuidParam(params.profileId, "profileId");
  if (!profileCheck.ok) return profileCheck.response;

  // Cross-company smuggling guard: the profile must belong to the
  // company in the URL path. Without this, an operator with admin
  // rights to company A could pass a profileId from company B and
  // initiate a connect against B's team.
  const profile = await getProfileById(profileCheck.value);
  if (!profile) return notFound("Profile not found.");
  if (profile.company_id !== idCheck.value) {
    return notFound("Profile not found in this company.");
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = parseBodyWith(ConnectSchema, body);
  if (!parsed.ok) return parsed.response;

  // The bundle-connect callback is shared with the hosted-portal flow.
  // popup=1 triggers the postMessage close path; company_id is what
  // the callback needs to sync downstream connection rows.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
    new URL(req.url).origin;
  const redirectUrl = `${origin}/api/platform/social/connections/callback?company_id=${idCheck.value}&popup=1`;

  const result = await initiateProfileConnect({
    profileId: profileCheck.value,
    platform: parsed.data.platform as ProfileSocialPlatform,
    redirectUrl,
    disableAutoLogin: parsed.data.disable_auto_login === true,
  });

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "VALIDATION_FAILED") return validationError(message);
    if (code === "RECEIVER_NOT_CONFIGURED") return invalidState(message);
    logger.error("admin.profile.connect.failed", {
      profile_id: profileCheck.value,
      company_id: idCheck.value,
      platform: parsed.data.platform,
      code,
      message,
    });
    return internalError(message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: {
        url: result.data.url,
        team_id: result.data.teamId,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
