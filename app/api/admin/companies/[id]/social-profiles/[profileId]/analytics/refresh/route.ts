import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  internalError,
  notFound as notFoundResponse,
  routeError,
  validateUuidParam,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { refreshAnalyticsForProfile } from "@/lib/platform/social/analytics-ingest";
import { getProfileById } from "@/lib/platform/social/profiles";

// ---------------------------------------------------------------------------
// POST /api/admin/companies/[id]/social-profiles/[profileId]/analytics/refresh
//
// Operator-triggered refresh. Calls the same code path as the daily
// cron but for one profile. bundle.social rate-limits at the team
// level (5 forced refreshes per day per team per platform); the SDK
// will surface its own error which we propagate to the UI as a 429.
//
// Gate: Opollo staff only — same pattern as the rest of /api/admin/*.
// The page UI lives under /admin which already gates on operator role,
// but the API double-gates for defence in depth.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string; profileId: string } },
): Promise<NextResponse> {
  const staffGate = await requireAdminForApi();
  if (staffGate.kind === "deny") return staffGate.response;

  const profileIdResult = validateUuidParam(ctx.params.profileId, "profileId");
  if (!profileIdResult.ok) return profileIdResult.response;
  const companyIdResult = validateUuidParam(ctx.params.id, "id");
  if (!companyIdResult.ok) return companyIdResult.response;

  // Verify the profile belongs to the company in the URL (cross-tenant guard).
  const profile = await getProfileById(profileIdResult.value);
  if (!profile) return notFoundResponse("Profile not found.");
  if (profile.company_id !== companyIdResult.value) {
    return notFoundResponse("Profile not found.");
  }

  if (!process.env.BUNDLE_SOCIAL_API) {
    return routeError(
      "RECEIVER_NOT_CONFIGURED",
      "BUNDLE_SOCIAL_API is not configured.",
    );
  }

  try {
    const outcome = await refreshAnalyticsForProfile({
      profileId: profileIdResult.value,
    });
    return NextResponse.json(
      { ok: true, data: outcome, timestamp: new Date().toISOString() },
      { status: outcome.account_failures > 0 ? 207 : 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("social.analytics.refresh.manual_failed", {
      err: message,
      profile_id: profileIdResult.value,
    });
    return internalError(message);
  }
}
