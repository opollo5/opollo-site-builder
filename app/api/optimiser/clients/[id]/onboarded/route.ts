import { NextResponse, type NextRequest } from "next/server";

import { checkAdminAccess } from "@/lib/admin-gate";
import { markOnboarded } from "@/lib/optimiser/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  await markOnboarded(ctx.params.id, access.user?.id ?? null);
  return NextResponse.json({ ok: true });
}
