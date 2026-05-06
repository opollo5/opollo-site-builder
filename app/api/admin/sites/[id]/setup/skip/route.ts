import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { internalError, notFound, readJsonBody, validateUuidParam, validationError } from "@/lib/http";
import { setStepStatus } from "@/lib/site-setup";

// ---------------------------------------------------------------------------
// POST /api/admin/sites/[id]/setup/skip
//
// DESIGN-DISCOVERY wizard. Skips Step 1 (design direction) or Step 2
// (tone of voice) by writing 'skipped' to the matching status column.
// Step 3 ('done') has no skip — it's just the summary screen.
//
// Body: { step: 1 | 2 }
//
// Admin-only. Operators don't manage sites at the configuration layer;
// they consume the configured site via briefs / batches.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  step: z.union([z.literal(1), z.literal(2)]),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const uuidCheck = validateUuidParam(params.id, "id");
  if (!uuidCheck.ok) return uuidCheck.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body must be { step: 1 | 2 }.",
          details: { issues: parsed.error.issues },
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  const result = await setStepStatus(params.id, parsed.data.step, "skipped");
  if (!result.ok) {
    const { code, message } = result.error;
    return code === "NOT_FOUND" ? notFound(message) : internalError(message);
  }

  revalidatePath(`/admin/sites/${params.id}/setup`);
  revalidatePath(`/admin/sites/${params.id}`);

  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
