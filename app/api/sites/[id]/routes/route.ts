import { requireAdminForApi } from "@/lib/admin-api-gate";
import { listActiveRoutes } from "@/lib/route-registry";
import { respond, validateUuidParam } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

// GET /api/sites/[id]/routes — list active (non-removed) routes for a site.
export async function GET(_req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  return respond(await listActiveRoutes(param.value));
}
