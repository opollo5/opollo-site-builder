import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import { revertSiteBlueprintToDraft } from "@/lib/site-blueprint";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";

export const runtime = "nodejs";

type RouteContext = { params: { id: string; blueprint_id: string } };

const RevertBodySchema = z.object({
  version_lock: z.number().int().nonnegative(),
  updated_by:   z.string().uuid().nullable().optional(),
});

// POST /api/sites/[id]/blueprints/[blueprint_id]/revert
export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const siteParam = validateUuidParam(ctx.params.id, "id");
  if (!siteParam.ok) return siteParam.response;

  const bpParam = validateUuidParam(ctx.params.blueprint_id, "blueprint_id");
  if (!bpParam.ok) return bpParam.response;

  const parsed = parseBodyWith(RevertBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  return respond(
    await revertSiteBlueprintToDraft(
      bpParam.value,
      parsed.data.version_lock,
      parsed.data.updated_by ?? null,
    ),
  );
}
