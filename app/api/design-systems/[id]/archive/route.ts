import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import { archiveDesignSystem } from "@/lib/design-systems";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";

export const runtime = "nodejs";

const BodySchema = z.object({
  expected_version_lock: z.number().int().positive(),
});

// POST /api/design-systems/[id]/archive — soft-archive the design system.
// When the target was the site's active DS, the success payload contains
// warnings[] noting the site now has no active design system (per §M1b Q6).
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("admin_write", `user:${gate.user?.id ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const body = parseBodyWith(BodySchema, await readJsonBody(req));
  if (!body.ok) return body.response;

  return respond(
    await archiveDesignSystem(param.value, body.data.expected_version_lock),
  );
}
