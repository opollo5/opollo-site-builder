import { z } from "zod";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  CreateDesignComponentSchema,
  createComponent,
  listComponents,
} from "@/lib/components";
import { getDesignSystemSitePrefix } from "@/lib/design-systems";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validationError,
  validateUuidParam,
} from "@/lib/http";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { validateScopedCss } from "@/lib/scope-prefix";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

// GET /api/design-systems/[id]/components — list components for a design system.
export async function GET(_req: Request, ctx: RouteContext) {
  // PLATFORM-AUDIT M15-4 #8: previously unguarded — matched by middleware only.
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;
  return respond(await listComponents(param.value));
}

// POST /api/design-systems/[id]/components — add a component.
//
// The body omits design_system_id (taken from the path) and may force the
// parent DS from the caller's input. Layer-2 CSS validation runs before the
// lib-level Zod pass, so prefix violations surface as a VALIDATION_FAILED
// envelope with the offending selectors listed.
const CreateBodySchema = CreateDesignComponentSchema.omit({
  design_system_id: true,
});

export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("admin_write", `user:${gate.user?.id ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const parsed = parseBodyWith(CreateBodySchema, await readJsonBody(req));
  if (!parsed.ok) return parsed.response;

  const prefixRes = await getDesignSystemSitePrefix(param.value);
  if (!prefixRes.ok) return respond(prefixRes);

  const cssCheck = validateScopedCss(parsed.data.css, prefixRes.data);
  if (!cssCheck.valid) {
    return validationError(
      `CSS contains class selector(s) not prefixed with "${prefixRes.data}-".`,
      { prefix: prefixRes.data, violations: cssCheck.violations },
    );
  }

  return respond(
    await createComponent({
      design_system_id: param.value,
      ...parsed.data,
    }),
  );
}
