import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, internalError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { update_template } from "@/lib/image/templates";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// PATCH /api/platform/image/templates/[id]
//
// Updates a template definition via update_image_template() RPC.
// Never direct UPDATE — versioning is handled by the RPC.
//
// Auth: canDo("create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  company_id: dbUuid(),
  definition: z.record(z.string(), z.unknown()),
  change_note: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Template id required." } }, { status: 404 });

  const body = await readJsonBody(req);
  if (!body) return validationError("Request body must be valid JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return validationError("Invalid body.", { issues: parsed.error.issues });

  const gate = await requireCanDoForApi(parsed.data.company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  try {
    const updated = await update_template({
      templateId: id,
      updatedBy: gate.userId,
      definition: parsed.data.definition as unknown as import("@/lib/image/templates").TemplateDefinition,
      changeNote: parsed.data.change_note,
    });

    return NextResponse.json({ ok: true, data: updated, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("template.update.failed", { id, err: err instanceof Error ? err.message : String(err) });
    return internalError(err instanceof Error ? err.message : "Template update failed.");
  }
}
