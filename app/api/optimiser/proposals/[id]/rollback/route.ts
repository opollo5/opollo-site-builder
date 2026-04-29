import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { manualRollbackProposal } from "@/lib/optimiser/change-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  reason: z.string().min(1).max(500),
});

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["admin", "operator"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  let body;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_BODY",
          message: err instanceof Error ? err.message : "Invalid body",
        },
      },
      { status: 400 },
    );
  }
  const result = await manualRollbackProposal({
    proposalId: ctx.params.id,
    actorUserId: access.user?.id ?? null,
    reason: body.reason,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "ROLLBACK_FAILED",
          message: result.message ?? "Rollback failed",
        },
      },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
