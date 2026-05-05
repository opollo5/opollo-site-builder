import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { readJsonBody } from "@/lib/http";
import { createVariantPair } from "@/lib/optimiser/variants/generator";

// POST /api/optimiser/proposals/[id]/create-variant — Slice 18.
//
// Generates an A/B test pair from an approved proposal:
//   - Variant A (control) — change set verbatim from the proposal
//   - Variant B (challenger) — structurally distinct alternative
//
// Both variants are submitted to the existing M12/M13 brief-runner.
// An opt_tests row is created in status='queued'. The activate step
// runs once both variants reach status='ready' (handled by the
// brief-runner integration; Slice 18's activator is also exposed for
// explicit operator-driven activation).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z
  .object({
    traffic_split_percent: z.number().int().min(1).max(99).optional(),
  })
  .partial();

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
  let body: { traffic_split_percent?: number } = {};
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

  const result = await createVariantPair({
    proposalId: ctx.params.id,
    approverUserId: access.user?.id ?? null,
    trafficSplitPercent: body.traffic_split_percent,
  });
  if (!result.ok) {
    const code = result.error.code;
    const status =
      code === "CONTEXT_LOAD_FAILED"
        ? 404
        : code === "INVALID_SPLIT"
          ? 400
          : 500;
    return NextResponse.json(
      { ok: false, error: result.error },
      { status },
    );
  }
  return NextResponse.json({
    ok: true,
    data: {
      variant_a: result.variant_a,
      variant_b: result.variant_b,
      test: result.test,
    },
  });
}
