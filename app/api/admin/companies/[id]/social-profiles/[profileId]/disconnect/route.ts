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
  disconnectProfileAccount,
  type ProfileSocialPlatform,
} from "@/lib/platform/social/profiles/connect";

// ---------------------------------------------------------------------------
// BSP-7 — POST /api/admin/companies/[id]/social-profiles/[profileId]/disconnect
//
// Body: { platform: <bundle.social platform enum> }
// Response: { ok: true, data: { team_id, platform } }
//
// Operator-only (super_admin or admin). Disconnects the (team, platform)
// pair on bundle.social. Idempotent — disconnecting an already-disconnected
// pair is a no-op success.
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

const DisconnectSchema = z.object({
  platform: PLATFORM_ENUM,
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

  // Cross-company smuggling guard: same shape as the connect route.
  const profile = await getProfileById(profileCheck.value);
  if (!profile) return notFound("Profile not found.");
  if (profile.company_id !== idCheck.value) {
    return notFound("Profile not found in this company.");
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = parseBodyWith(DisconnectSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await disconnectProfileAccount({
    profileId: profileCheck.value,
    platform: parsed.data.platform as ProfileSocialPlatform,
  });

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "VALIDATION_FAILED") return validationError(message);
    if (code === "RECEIVER_NOT_CONFIGURED") return invalidState(message);
    logger.error("admin.profile.disconnect.failed", {
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
        team_id: result.data.teamId,
        platform: result.data.platform,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
