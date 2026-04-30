import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { upsertCredential } from "@/lib/optimiser/credentials";
import { verifyClarity } from "@/lib/optimiser/verify-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({
  api_token: z.string().min(8),
  external_account_label: z.string().optional(),
});

// Save Clarity credentials (step 3 of onboarding).
export async function PUT(
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
    body = PutBody.parse(await req.json());
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
  await upsertCredential({
    clientId: ctx.params.id,
    source: "clarity",
    payload: { api_token: body.api_token },
    externalAccountLabel: body.external_account_label,
    updatedBy: access.user?.id ?? null,
  });
  return NextResponse.json({ ok: true });
}

// Verify Clarity is reporting (step 3 verifier).
export async function GET(
  _req: NextRequest,
  ctx: { params: { id: string } },
): Promise<NextResponse> {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  const result = await verifyClarity(ctx.params.id);
  return NextResponse.json({ ok: true, data: result });
}
