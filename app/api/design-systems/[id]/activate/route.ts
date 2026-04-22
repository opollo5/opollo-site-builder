import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import { activateDesignSystem } from "@/lib/design-systems";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";

export const runtime = "nodejs";

const BodySchema = z.object({
  expected_version_lock: z.number().int().positive(),
});

// POST /api/design-systems/[id]/activate — promotes the target DS and
// archives any currently-active DS for the same site, atomically, via the
// activate_design_system RPC from 0003_m1b_rpcs.sql.
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const body = parseBodyWith(BodySchema, await readJsonBody(req));
  if (!body.ok) return body.response;

  return respond(
    await activateDesignSystem(param.value, body.data.expected_version_lock),
  );
}
