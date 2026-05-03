import { NextResponse } from "next/server";
import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getDesignSystem } from "@/lib/design-systems";
import { listComponents } from "@/lib/components";
import { listTemplates } from "@/lib/templates";
import { respond, validateUuidParam } from "@/lib/http";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";

export const runtime = "nodejs";

// GET /api/design-systems/[id]/preview
//
// Bundles everything the preview gallery UI (M1e-4) needs in one round-trip:
// the DS row itself plus all components and templates. Any design system —
// draft, active, or archived — is previewable.
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  // PLATFORM-AUDIT PR3 — design system bodies aren't sensitive but the
  // route was unauthed entirely. Gate to admin tier minimum (defense in
  // depth; consistent with sibling /api/design-systems/[id] routes).
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("admin_write", `user:${gate.user?.id ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const param = validateUuidParam(ctx.params.id, "id");
  if (!param.ok) return param.response;

  const dsRes = await getDesignSystem(param.value);
  if (!dsRes.ok) return respond(dsRes);

  const [compRes, tmplRes] = await Promise.all([
    listComponents(param.value),
    listTemplates(param.value),
  ]);

  if (!compRes.ok) return respond(compRes);
  if (!tmplRes.ok) return respond(tmplRes);

  return NextResponse.json(
    {
      ok: true,
      data: {
        design_system: dsRes.data,
        components: compRes.data,
        templates: tmplRes.data,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
