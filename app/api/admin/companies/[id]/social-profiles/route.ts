import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  conflict,
  internalError,
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import {
  createProfile,
  listProfilesForCompany,
} from "@/lib/platform/social/profiles";

// ---------------------------------------------------------------------------
// BSP-5 — admin profile collection endpoint.
//
// GET    /api/admin/companies/[id]/social-profiles
// POST   /api/admin/companies/[id]/social-profiles
//
// Operator-only (requireAdminForApi). Customers don't manage their own
// profiles in this slice; they get a backfilled default profile from
// migration 0118 and contact Opollo to add executive add-ons.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateProfileSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["company", "executive"]),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  try {
    const profiles = await listProfilesForCompany(idCheck.value);
    return NextResponse.json(
      {
        ok: true,
        data: { profiles },
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("admin.social_profiles.list.failed", {
      company_id: idCheck.value,
      err: msg,
    });
    return internalError("Failed to load profiles.");
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = parseBodyWith(CreateProfileSchema, body);
  if (!parsed.ok) return parsed.response;

  const result = await createProfile({
    companyId: idCheck.value,
    name: parsed.data.name,
    kind: parsed.data.kind,
  });

  if (!result.ok) {
    const { code, message } = result.error;
    if (code === "VALIDATION_FAILED") return validationError(message);
    if (code === "ALREADY_EXISTS") return conflict(code, message);
    logger.error("admin.social_profiles.create.failed", {
      company_id: idCheck.value,
      code,
      message,
    });
    return internalError(message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: { profile: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
