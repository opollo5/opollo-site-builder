import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import {
  getCredentialMeta,
  readCredential,
  upsertCredential,
} from "@/lib/optimiser/credentials";
import { verifyGa4 } from "@/lib/optimiser/verify-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({
  property_id: z.string().regex(/^\d{6,}$/),
  base_url: z.string().url().optional(),
});

export async function PUT(
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

  const existing = await getCredentialMeta(ctx.params.id, "ga4");
  if (!existing) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NO_REFRESH_TOKEN",
          message: "Connect GA4 first.",
        },
      },
      { status: 400 },
    );
  }
  const { payload } = await readCredential(ctx.params.id, "ga4");
  await upsertCredential({
    clientId: ctx.params.id,
    source: "ga4",
    payload: { ...payload, property_id: body.property_id },
    externalAccountId: body.property_id,
    externalAccountLabel: body.base_url,
    updatedBy: access.user?.id ?? null,
  });
  return NextResponse.json({ ok: true });
}

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
  const result = await verifyGa4(ctx.params.id);
  return NextResponse.json({ ok: true, data: result });
}
