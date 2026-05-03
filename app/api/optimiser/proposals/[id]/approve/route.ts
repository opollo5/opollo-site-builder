import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { readJsonBody } from "@/lib/http";
import { approveProposal } from "@/lib/optimiser/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  pre_build_reprompt: z.string().max(2000).optional(),
  unchecked_evidence: z.array(z.string().uuid()).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  let body;
  try {
    body = Body.parse(await readJsonBody(req) ?? {});
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
  const result = await approveProposal({
    proposalId: ctx.params.id,
    approverUserId: access.user?.id ?? null,
    preBuildReprompt: body.pre_build_reprompt,
    uncheckedEvidence: body.unchecked_evidence,
  });
  if (!result.ok) {
    const status =
      result.code === "EXPIRED" || result.code === "GUARDRAIL_FAILED"
        ? 409
        : result.code === "STATUS_CONFLICT"
          ? 409
          : 500;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: result.code,
          message: result.message,
          ...(result.guardrail ? { guardrail: result.guardrail } : {}),
        },
      },
      { status },
    );
  }
  return NextResponse.json({ ok: true, data: result });
}
