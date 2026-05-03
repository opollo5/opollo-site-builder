import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody } from "@/lib/http";
import { updateSiteVoice } from "@/lib/sites";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// PATCH /api/admin/sites/[id]/voice — RS-2.
//
// Edit the site-level brand_voice / design_direction defaults. Per-brief
// overrides on the briefs table still win at commit time.
//
// Admin OR operator role: voice/direction copy is editorial, not
// financial. Operators routinely tune it as part of customer onboarding.
// (Compare to /budget which is admin-only.)
//
// Optimistic-locked on sites.version_lock; concurrent edits surface
// VERSION_CONFLICT (409) with the current server-side version.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FIELD_BYTES = 4096;

const PatchSchema = z
  .object({
    brand_voice: z
      .union([z.string().max(MAX_FIELD_BYTES), z.null()])
      .optional(),
    design_direction: z
      .union([z.string().max(MAX_FIELD_BYTES), z.null()])
      .optional(),
  })
  .refine(
    (p) =>
      p.brand_voice !== undefined || p.design_direction !== undefined,
    {
      message:
        "At least one of brand_voice or design_direction is required.",
    },
  );

const BodySchema = z.object({
  expected_version_lock: z.number().int().min(1),
  patch: PatchSchema,
});

function errorJson(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, ...(details ? { details } : {}) },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson("VALIDATION_FAILED", "Site id must be a UUID.", 400);
  }

  const body = await readJsonBody(req);
  if (body === undefined) return errorJson("VALIDATION_FAILED", "Request body must be valid JSON.", 400);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body failed validation.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await updateSiteVoice(
    params.id,
    parsed.data.expected_version_lock,
    parsed.data.patch,
  );

  if (!result.ok) {
    const status = errorCodeToStatus(
      result.error.code === "VERSION_CONFLICT"
        ? "VERSION_CONFLICT"
        : result.error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : "INTERNAL_ERROR",
    );
    return errorJson(
      result.error.code,
      result.error.message,
      status,
      result.error.details,
    );
  }

  revalidatePath(`/admin/sites/${params.id}`);
  revalidatePath(`/admin/sites/${params.id}/settings`);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
