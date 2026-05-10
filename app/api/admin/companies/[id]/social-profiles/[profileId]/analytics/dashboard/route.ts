import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  notFound as notFoundResponse,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  getProfileAnalyticsDashboard,
  type AnalyticsDateRange,
} from "@/lib/platform/social/analytics-ingest";
import { getProfileById } from "@/lib/platform/social/profiles";

// GET /api/admin/companies/[id]/social-profiles/[profileId]/analytics/dashboard?range=7|30|90
//
// Returns the dashboard payload for the requested range. Used by the
// client-side date-range picker to refresh data without a full page
// reload.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_RANGES: readonly AnalyticsDateRange[] = [7, 30, 90];

export async function GET(
  req: NextRequest,
  ctx: { params: { id: string; profileId: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  const profileIdResult = validateUuidParam(ctx.params.profileId, "profileId");
  if (!profileIdResult.ok) return profileIdResult.response;
  const companyIdResult = validateUuidParam(ctx.params.id, "id");
  if (!companyIdResult.ok) return companyIdResult.response;

  const rangeRaw = new URL(req.url).searchParams.get("range") ?? "30";
  const rangeParsed = parseInt(rangeRaw, 10) as AnalyticsDateRange;
  if (!ALLOWED_RANGES.includes(rangeParsed)) {
    return validationError(`range must be one of ${ALLOWED_RANGES.join("|")}`);
  }

  const profile = await getProfileById(profileIdResult.value);
  if (!profile) return notFoundResponse("Profile not found.");
  if (profile.company_id !== companyIdResult.value) {
    return notFoundResponse("Profile not found.");
  }

  try {
    const data = await getProfileAnalyticsDashboard({
      profileId: profileIdResult.value,
      rangeDays: rangeParsed,
    });
    return NextResponse.json(
      { ok: true, data, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("social.analytics.dashboard.fetch_failed", {
      err: message,
      profile_id: profileIdResult.value,
    });
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERNAL_ERROR", message },
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
