import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody, respond, validationError } from "@/lib/http";
import { updateSiteVoice } from "@/lib/sites";

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return validationError("Site id must be a UUID.");
  }

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body failed validation.", { issues: parsed.error.issues });
  }

  const result = await updateSiteVoice(
    params.id,
    parsed.data.expected_version_lock,
    parsed.data.patch,
  );

  if (!result.ok) {
    return respond(result);
  }

  revalidatePath(`/admin/sites/${params.id}`);
  revalidatePath(`/admin/sites/${params.id}/settings`);

  return NextResponse.json(
    { ok: true, data: result.data, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
