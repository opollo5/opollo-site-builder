import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import {
  getCredentialMeta,
  readCredential,
  upsertCredential,
} from "@/lib/optimiser/credentials";
import { verifyAds } from "@/lib/optimiser/verify-connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PutBody = z.object({
  customer_id: z.string().regex(/^\d{6,}$/),
  login_customer_id: z.string().regex(/^\d{6,}$/).optional(),
  external_account_label: z.string().optional(),
});

// Sets the Ads customer_id after the user picked a managed account in
// the OAuth flow.
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

  const existing = await getCredentialMeta(ctx.params.id, "google_ads");
  if (!existing) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NO_REFRESH_TOKEN",
          message: "Connect Google Ads first.",
        },
      },
      { status: 400 },
    );
  }
  const { payload } = await readCredential(ctx.params.id, "google_ads");
  await upsertCredential({
    clientId: ctx.params.id,
    source: "google_ads",
    payload: {
      ...payload,
      customer_id: body.customer_id,
      ...(body.login_customer_id
        ? { login_customer_id: body.login_customer_id }
        : {}),
    },
    externalAccountId: body.customer_id,
    externalAccountLabel: body.external_account_label,
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
  const result = await verifyAds(ctx.params.id);
  return NextResponse.json({ ok: true, data: result });
}
