import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  createDesignSystem,
  listDesignSystems,
} from "@/lib/design-systems";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

// GET /api/sites/[id]/design-systems — list versions for a site.
export async function GET(_req: Request, ctx: RouteContext) {
  // PLATFORM-AUDIT M15-4 #8: previously unguarded — matched by middleware only.
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;
  return respond(await listDesignSystems(param.value));
}

// POST /api/sites/[id]/design-systems — create a new DRAFT.
//
// `version` is optional in the body. When omitted, the route picks the
// next integer above the current max version for this site. Operators can
// override if they need a specific version number.
const CreateBodySchema = z.object({
  tokens_css: z.string(),
  base_styles: z.string(),
  notes: z.string().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
  version: z.number().int().positive().optional(),
});

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const parsed = parseBodyWith(CreateBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  let version = parsed.data.version;
  if (version === undefined) {
    const listRes = await listDesignSystems(param.value);
    if (!listRes.ok) return respond(listRes);
    const max = listRes.data.reduce((m, d) => Math.max(m, d.version), 0);
    version = max + 1;
  }

  const result = await createDesignSystem({
    site_id: param.value,
    version,
    tokens_css: parsed.data.tokens_css,
    base_styles: parsed.data.base_styles,
    notes: parsed.data.notes ?? null,
    created_by: parsed.data.created_by ?? null,
  });
  return respond(result);
}
