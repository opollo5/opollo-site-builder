import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  conflict,
  dbUuid,
  internalError,
  notFound,
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  checkCrossTenantConflict,
  emitConnectionReattributed,
  emitCrossTenantOverride,
} from "@/lib/platform/social/connections/identity";
import { getServiceRoleClient } from "@/lib/supabase";

// Cross-tenant identity-leak defence — Layer 4 admin maintenance.
// Reattributes a social_connections row to a different company/profile.
// Runs checkCrossTenantConflict (excluding self) against the new target.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  target_company_id: dbUuid(),
  target_profile_id: dbUuid().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Body must be JSON.");
  const parsed = parseBodyWith(Schema, body);
  if (!parsed.ok) return parsed.response;

  const svc = getServiceRoleClient();
  const row = await svc
    .from("social_connections")
    .select(
      "id, company_id, profile_id, platform, external_account_id, external_user_id, external_identity_hash",
    )
    .eq("id", idCheck.value)
    .maybeSingle();
  if (row.error) return internalError(row.error.message);
  if (!row.data) return notFound("Connection not found.");

  const targetCompany = await svc
    .from("platform_companies")
    .select("id")
    .eq("id", parsed.data.target_company_id)
    .maybeSingle();
  if (targetCompany.error) return internalError(targetCompany.error.message);
  if (!targetCompany.data) return notFound("Target company not found.");

  if (parsed.data.target_profile_id) {
    const targetProfile = await svc
      .from("platform_social_profiles")
      .select("id, company_id")
      .eq("id", parsed.data.target_profile_id)
      .maybeSingle();
    if (targetProfile.error) return internalError(targetProfile.error.message);
    if (!targetProfile.data) return notFound("Target profile not found.");
    if (
      (targetProfile.data as { company_id: string }).company_id !==
      parsed.data.target_company_id
    ) {
      return notFound("Target profile does not belong to target company.");
    }
  }

  const conflictResult = await checkCrossTenantConflict({
    platform: row.data.platform as string,
    identity_hash: row.data.external_identity_hash as string | null,
    external_account_id: row.data.external_account_id as string | null,
    external_user_id: row.data.external_user_id as string | null,
    target_company_id: parsed.data.target_company_id,
    target_profile_id: parsed.data.target_profile_id,
    excludeConnectionId: idCheck.value,
  });

  if (!conflictResult.ok) {
    if (conflictResult.override_allowed) {
      void emitCrossTenantOverride({
        platform: row.data.platform as string,
        identity_hash: row.data.external_identity_hash as string | null,
        external_account_id: row.data.external_account_id as string | null,
        external_user_id: row.data.external_user_id as string | null,
        target_company_id: parsed.data.target_company_id,
        target_profile_id: parsed.data.target_profile_id,
        actor_user_id: gate.user?.id ?? null,
        conflicting_rows: conflictResult.conflicting_rows,
      });
      logger.warn("admin.maintenance.reattribute.override", {
        connection_id: idCheck.value,
        target_company_id: parsed.data.target_company_id,
      });
    } else {
      return conflict(
        "CONFLICT",
        `Reattribute refused — ${conflictResult.code === "CROSS_TENANT" ? "another company" : "another profile"} already owns this identity.`,
        {
          conflict_code: conflictResult.code,
          conflicting_rows: conflictResult.conflicting_rows.map((r) => ({
            id: r.id,
            company_id: r.company_id,
            profile_id: r.profile_id,
            platform: r.platform,
            display_name: r.display_name,
          })),
        },
      );
    }
  }

  const update = await svc
    .from("social_connections")
    .update({
      company_id: parsed.data.target_company_id,
      profile_id: parsed.data.target_profile_id,
    })
    .eq("id", idCheck.value);
  if (update.error) {
    logger.error("admin.maintenance.reattribute.failed", {
      connection_id: idCheck.value,
      err: update.error.message,
    });
    return internalError(update.error.message);
  }

  void emitConnectionReattributed({
    connection_id: idCheck.value,
    platform: row.data.platform as string,
    from_company_id: row.data.company_id as string,
    to_company_id: parsed.data.target_company_id,
    from_profile_id: row.data.profile_id as string | null,
    to_profile_id: parsed.data.target_profile_id,
    actor_user_id: gate.user?.id ?? null,
  });

  return NextResponse.json({
    ok: true,
    data: {
      id: idCheck.value,
      company_id: parsed.data.target_company_id,
      profile_id: parsed.data.target_profile_id,
    },
    timestamp: new Date().toISOString(),
  });
}
