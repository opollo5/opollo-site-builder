import { NextResponse, type NextRequest } from "next/server";

import { dbUuid, validationError, internalError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { TEMPLATE_SCHEMA_VERSION } from "@/lib/image/template-model";
import type { TemplateField, Template, Layer } from "@/lib/image/template-model";

// ---------------------------------------------------------------------------
// GET /api/platform/image/templates/[id]/fields
//
// Returns the modifiable layer names + types + variable metadata for a
// schema_version=2 template (§13 of the design spec). Used by the N-Series
// social composer to auto-build typed form inputs without per-template code.
//
// Only layers that carry a `var` object with a non-empty `label` are included
// — layers without variable metadata are implementation details, not API fields.
//
// Auth: canDo("create_post") — same permission as the editor.
//
// Response shape:
//   { ok: true, fields: TemplateField[] }
//   where TemplateField = { name, type, var: VarMetadata }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return validationError("Template id required.");

  // company_id is required for auth scoping.
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !dbUuid().safeParse(companyId).success) {
    return validationError("company_id query param is required (valid UUID).");
  }

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  try {
    const svc = getServiceRoleClient();

    const { data, error } = await svc
      .from("image_templates")
      .select("id, schema_version, definition")
      .eq("id", id)
      .eq("is_active", true)
      .or(`company_id.eq.${companyId},company_id.is.null`)
      .maybeSingle();

    if (error) {
      logger.error("image.templates.fields.db_error", { id, error: error.message });
      return internalError(error.message);
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "Template not found." } },
        { status: 404 },
      );
    }

    if (data.schema_version !== TEMPLATE_SCHEMA_VERSION) {
      // v1 fixed-zone templates have no layer-level var metadata.
      return NextResponse.json({ ok: true, fields: [] });
    }

    const template = data.definition as Template;
    const fields: TemplateField[] = [];

    for (const layer of template.layers ?? []) {
      const l = layer as Layer;
      if (
        l.var &&
        typeof l.var.label === "string" &&
        l.var.label.trim().length > 0 &&
        (l.type === "text" || l.type === "image" || l.type === "rectangle")
      ) {
        fields.push({
          name: l.name,
          type: l.type,
          var: l.var,
        });
      }
    }

    return NextResponse.json({ ok: true, fields });
  } catch (err) {
    logger.error("image.templates.fields.failed", { id, err: err instanceof Error ? err.message : String(err) });
    return internalError(err instanceof Error ? err.message : "Failed to retrieve template fields.");
  }
}
