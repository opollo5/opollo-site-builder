import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { rejectProposal } from "@/lib/optimiser/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  reason_code: z.enum([
    "not_aligned_brand",
    "offer_change_not_approved",
    "bad_timing",
    "design_conflict",
    "other",
  ]),
  reason_text: z.string().max(2000).optional(),
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
  const result = await rejectProposal({
    proposalId: ctx.params.id,
    rejecterUserId: access.user?.id ?? null,
    reasonCode: body.reason_code,
    reasonText: body.reason_text,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: { code: result.code, message: result.message } },
      { status: result.code === "STATUS_CONFLICT" ? 409 : 500 },
    );
  }
  return NextResponse.json({ ok: true, data: result });
}
