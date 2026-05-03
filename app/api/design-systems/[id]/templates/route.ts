import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  CreateDesignTemplateSchema,
  createTemplate,
  listTemplates,
} from "@/lib/templates";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";
import { validateCompositionRefs } from "./_helpers";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

// GET /api/design-systems/[id]/templates
export async function GET(_req: Request, ctx: RouteContext) {
  // PLATFORM-AUDIT M15-4 #8: previously unguarded — matched by middleware only.
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;
  return respond(await listTemplates(param.value));
}

// POST /api/design-systems/[id]/templates — create a template.
//
// Composition-reference pre-flight: every composition[].component must
// exist in the parent design system's components. Same invariant the seed
// script enforces (scripts/seed-leadsource.ts), re-checked here because the
// admin UI is the other way new templates can be introduced.
const CreateBodySchema = CreateDesignTemplateSchema.omit({
  design_system_id: true,
});

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const parsed = parseBodyWith(CreateBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  const refCheck = await validateCompositionRefs(
    param.value,
    parsed.data.composition.map((c) => c.component),
  );
  if (refCheck !== null) return refCheck;

  return respond(
    await createTemplate({
      design_system_id: param.value,
      ...parsed.data,
    }),
  );
}
