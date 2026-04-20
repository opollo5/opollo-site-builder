import { z } from "zod";
import {
  UpdateDesignComponentSchema,
  deleteComponent,
  updateComponent,
} from "@/lib/components";
import { getDesignSystemSitePrefix } from "@/lib/design-systems";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validationError,
  validateUuidParam,
} from "@/lib/http";
import { validateScopedCss } from "@/lib/scope-prefix";

export const runtime = "nodejs";

type RouteContext = { params: { id: string; cid: string } };

// PATCH /api/design-systems/[id]/components/[cid]
//
// The body merges the updatable fields from UpdateDesignComponentSchema with
// the optimistic-lock token. If the patch touches CSS, we revalidate the
// scope prefix against the parent design system's site.
const PatchBodySchema = UpdateDesignComponentSchema.and(
  z.object({
    expected_version_lock: z.number().int().positive(),
  }),
);

export async function PATCH(req: Request, ctx: RouteContext) {
  const dsParam = validateUuidParam(ctx.params.id, "id");
  if (!dsParam.ok) return dsParam.response;
  const cidParam = validateUuidParam(ctx.params.cid, "cid");
  if (!cidParam.ok) return cidParam.response;

  const parsed = parseBodyWith(PatchBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  const { expected_version_lock, ...patch } = parsed.data;

  if (patch.css !== undefined) {
    const prefixRes = await getDesignSystemSitePrefix(dsParam.value);
    if (!prefixRes.ok) return respond(prefixRes);
    const check = validateScopedCss(patch.css, prefixRes.data);
    if (!check.valid) {
      return validationError(
        `CSS contains class selector(s) not prefixed with "${prefixRes.data}-".`,
        { prefix: prefixRes.data, violations: check.violations },
      );
    }
  }

  return respond(
    await updateComponent(cidParam.value, patch, expected_version_lock),
  );
}

// DELETE /api/design-systems/[id]/components/[cid]?expected_version_lock=N
//
// expected_version_lock rides as a query param per the M1e plan (DELETE
// with a body is unreliable across proxies).
export async function DELETE(req: Request, ctx: RouteContext) {
  const dsParam = validateUuidParam(ctx.params.id, "id");
  if (!dsParam.ok) return dsParam.response;
  const cidParam = validateUuidParam(ctx.params.cid, "cid");
  if (!cidParam.ok) return cidParam.response;

  const url = new URL(req.url);
  const raw = url.searchParams.get("expected_version_lock");
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  if (!parsed.success) {
    return validationError(
      `Query param "expected_version_lock" must be a positive integer.`,
      { received: raw },
    );
  }

  return respond(await deleteComponent(cidParam.value, parsed.data));
}
