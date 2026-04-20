import { z } from "zod";
import {
  UpdateDesignTemplateSchema,
  deleteTemplate,
  updateTemplate,
} from "@/lib/templates";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validationError,
  validateUuidParam,
} from "@/lib/http";
import { validateCompositionRefs } from "../_helpers";

export const runtime = "nodejs";

type RouteContext = { params: { id: string; tid: string } };

const PatchBodySchema = UpdateDesignTemplateSchema.and(
  z.object({
    expected_version_lock: z.number().int().positive(),
  }),
);

// PATCH /api/design-systems/[id]/templates/[tid]
//
// If the patch rewrites composition, we re-run the reference check against
// the current set of components in the parent DS. Renaming a component
// elsewhere after a template already referenced it could otherwise leave a
// dangling ref; this route refuses such writes at the admin layer.
export async function PATCH(req: Request, ctx: RouteContext) {
  const dsParam = validateUuidParam(ctx.params.id, "id");
  if (!dsParam.ok) return dsParam.response;
  const tidParam = validateUuidParam(ctx.params.tid, "tid");
  if (!tidParam.ok) return tidParam.response;

  const parsed = parseBodyWith(PatchBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  const { expected_version_lock, ...patch } = parsed.data;

  if (patch.composition !== undefined) {
    const refCheck = await validateCompositionRefs(
      dsParam.value,
      patch.composition.map((c) => c.component),
    );
    if (refCheck !== null) return refCheck;
  }

  return respond(
    await updateTemplate(tidParam.value, patch, expected_version_lock),
  );
}

// DELETE /api/design-systems/[id]/templates/[tid]?expected_version_lock=N
export async function DELETE(req: Request, ctx: RouteContext) {
  const dsParam = validateUuidParam(ctx.params.id, "id");
  if (!dsParam.ok) return dsParam.response;
  const tidParam = validateUuidParam(ctx.params.tid, "tid");
  if (!tidParam.ok) return tidParam.response;

  const url = new URL(req.url);
  const raw = url.searchParams.get("expected_version_lock");
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  if (!parsed.success) {
    return validationError(
      `Query param "expected_version_lock" must be a positive integer.`,
      { received: raw },
    );
  }

  return respond(await deleteTemplate(tidParam.value, parsed.data));
}
