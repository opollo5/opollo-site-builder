import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { internalError, notFound, validateUuidParam } from "@/lib/http";
import { logger } from "@/lib/logger";
import { computeIdentityHash, resolveIdentityFingerprint } from "@/lib/platform/social/connections/identity";
import { getServiceRoleClient } from "@/lib/supabase";

// Cross-tenant identity-leak defence — Layer 4 admin maintenance.
// Re-resolves the identity for a single social_connections row.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORM_TO_BUNDLE: Record<string, string> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  x: "TWITTER",
  gbp: "GOOGLE_BUSINESS",
};

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const svc = getServiceRoleClient();
  const row = await svc
    .from("social_connections")
    .select("id, company_id, profile_id, platform")
    .eq("id", idCheck.value)
    .maybeSingle();
  if (row.error) return internalError(row.error.message);
  if (!row.data) return notFound("Connection not found.");

  let teamId: string | null = null;
  const profileId = row.data.profile_id as string | null;
  if (profileId) {
    const profile = await svc
      .from("platform_social_profiles")
      .select("bundle_social_team_id")
      .eq("id", profileId)
      .maybeSingle();
    teamId =
      (profile.data as { bundle_social_team_id?: string } | null)
        ?.bundle_social_team_id ?? null;
  }
  if (!teamId) {
    const company = await svc
      .from("platform_companies")
      .select("bundle_social_team_id")
      .eq("id", row.data.company_id as string)
      .maybeSingle();
    teamId =
      (company.data as { bundle_social_team_id?: string } | null)
        ?.bundle_social_team_id ?? null;
  }
  if (!teamId) return internalError("No bundle.social team_id resolvable.");

  const bundleType = PLATFORM_TO_BUNDLE[row.data.platform as string];
  if (!bundleType) return internalError(`Unsupported platform: ${row.data.platform}`);

  const rawIdentity = await resolveIdentityFingerprint({
    platform: bundleType as Parameters<typeof resolveIdentityFingerprint>[0]["platform"],
    teamId,
  });
  const platformDb = row.data.platform as string;
  const identity = {
    ...rawIdentity,
    external_identity_hash: computeIdentityHash(
      platformDb,
      rawIdentity.external_account_id,
      rawIdentity.external_user_id,
    ),
  };

  const update = await svc
    .from("social_connections")
    .update({
      external_account_id: identity.external_account_id,
      external_user_id: identity.external_user_id,
      external_identity_hash: identity.external_identity_hash,
      status:
        identity.external_account_id || identity.external_user_id
          ? "healthy"
          : "pending_identity",
      last_health_check_at: new Date().toISOString(),
    })
    .eq("id", idCheck.value);
  if (update.error) {
    logger.error("admin.maintenance.refresh_identity.failed", {
      connection_id: idCheck.value,
      err: update.error.message,
    });
    return internalError(update.error.message);
  }

  return NextResponse.json({
    ok: true,
    data: {
      external_account_id: identity.external_account_id,
      external_user_id: identity.external_user_id,
      external_identity_hash: identity.external_identity_hash,
    },
    timestamp: new Date().toISOString(),
  });
}
