import { NextResponse } from "next/server";
import { getDesignSystem } from "@/lib/design-systems";
import { listComponents } from "@/lib/components";
import { listTemplates } from "@/lib/templates";
import { respond, validateUuidParam } from "@/lib/http";

export const runtime = "nodejs";

// GET /api/design-systems/[id]/preview
//
// Bundles everything the preview gallery UI (M1e-4) needs in one round-trip:
// the DS row itself plus all components and templates. Any design system —
// draft, active, or archived — is previewable.
export async function GET(_req: Request, ctx: { params: { id: string } }) {
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
