import { NextResponse, type NextRequest } from "next/server";

import { checkAdminAccess } from "@/lib/admin-gate";
import { getLandingPage } from "@/lib/optimiser/landing-pages";
import { planPageImport } from "@/lib/optimiser/page-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Page import (§7.5). Phase 1 always returns the manual rebuild plan;
// the auto path is gated on OPT_AUTO_IMPORT_ENABLED + Site Builder
// brief_shape=import support (Phase 1.5).
export async function POST(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  const page = await getLandingPage(ctx.params.id);
  if (!page) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Page not found" } },
      { status: 404 },
    );
  }
  try {
    const plan = await planPageImport({
      clientId: page.client_id,
      pageId: page.id,
    });
    return NextResponse.json({ ok: true, data: plan });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "IMPORT_PLAN_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}
