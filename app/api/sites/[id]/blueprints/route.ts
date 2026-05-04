import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getSiteBlueprint } from "@/lib/site-blueprint";
import { runSitePlanner } from "@/lib/site-planner";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

// GET /api/sites/[id]/blueprints — return current blueprint for the site.
export async function GET(_req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  return respond(await getSiteBlueprint(param.value));
}

// POST /api/sites/[id]/blueprints — trigger site planner (Pass 0+1).
// Body: { brief_id: string }
const TriggerBodySchema = z.object({
  brief_id: z.string().uuid(),
});

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const parsed = parseBodyWith(TriggerBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  const result = await runSitePlanner({
    siteId:  param.value,
    briefId: parsed.data.brief_id,
  });

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: result.error,
        timestamp: new Date().toISOString(),
      },
      { status: 422 },
    );
  }

  return Response.json(
    {
      ok:        true,
      data:      { blueprint: result.blueprint, cached: result.cached },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
