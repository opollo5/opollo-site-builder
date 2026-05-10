import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  conflict,
  internalError,
  invalidState,
  notFound,
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  deleteProfile,
  renameProfile,
  setDefaultProfile,
} from "@/lib/platform/social/profiles";

// ---------------------------------------------------------------------------
// BSP-5 — admin profile per-row endpoints.
//
// PATCH  /api/admin/companies/[id]/social-profiles/[profileId]
//        body: { name?: string, set_default?: true }
//        Either renames or promotes to default. Both operations on the
//        same row in one call is allowed (rename + promote in one go).
//
// DELETE /api/admin/companies/[id]/social-profiles/[profileId]
//        Cannot delete the default profile (DEFAULT_PROFILE_PROTECTED).
//
// Operator-only (requireAdminForApi).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PatchSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    set_default: z.literal(true).optional(),
  })
  .refine((d) => d.name !== undefined || d.set_default === true, {
    message: "Body must include name or set_default.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; profileId: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;
  const profileCheck = validateUuidParam(params.profileId, "profileId");
  if (!profileCheck.ok) return profileCheck.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = parseBodyWith(PatchSchema, body);
  if (!parsed.ok) return parsed.response;

  // Rename first if requested (cheaper to fail fast on a name conflict
  // than to do the default-flip and then have to undo it).
  let lastProfile = null;
  if (parsed.data.name !== undefined) {
    const renameResult = await renameProfile({
      profileId: profileCheck.value,
      newName: parsed.data.name,
    });
    if (!renameResult.ok) {
      const { code, message } = renameResult.error;
      if (code === "VALIDATION_FAILED") return validationError(message);
      if (code === "NOT_FOUND") return notFound(message);
      if (code === "ALREADY_EXISTS") return conflict(code, message);
      logger.error("admin.social_profiles.rename.failed", {
        profile_id: profileCheck.value,
        code,
        message,
      });
      return internalError(message);
    }
    lastProfile = renameResult.data;
  }

  if (parsed.data.set_default === true) {
    const promoteResult = await setDefaultProfile({
      companyId: idCheck.value,
      profileId: profileCheck.value,
    });
    if (!promoteResult.ok) {
      const { code, message } = promoteResult.error;
      if (code === "NOT_FOUND") return notFound(message);
      logger.error("admin.social_profiles.set_default.failed", {
        profile_id: profileCheck.value,
        company_id: idCheck.value,
        code,
        message,
      });
      return internalError(message);
    }
    lastProfile = promoteResult.data;
  }

  return NextResponse.json(
    {
      ok: true,
      data: { profile: lastProfile },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; profileId: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;
  const profileCheck = validateUuidParam(params.profileId, "profileId");
  if (!profileCheck.ok) return profileCheck.response;

  const result = await deleteProfile({ profileId: profileCheck.value });
  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "NOT_FOUND") return notFound(message);
    if (code === "INVALID_STATE") return invalidState(message);
    logger.error("admin.social_profiles.delete.failed", {
      profile_id: profileCheck.value,
      code,
      message,
    });
    return internalError(message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { deleted_id: result.data.deleted_id },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
