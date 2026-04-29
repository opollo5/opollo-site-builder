import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { getClient, updateClient } from "@/lib/optimiser/clients";
import { getConnectorStatus } from "@/lib/optimiser/connector-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UpdateClientBody = z.object({
  name: z.string().min(1).max(120).optional(),
  primary_contact_email: z.string().email().nullable().optional(),
  hosting_mode: z
    .enum(["opollo_subdomain", "opollo_cname", "client_slice"])
    .optional(),
  hosting_cname_host: z.string().nullable().optional(),
  llm_monthly_budget_usd: z.number().int().min(0).max(10000).optional(),
  cross_client_learning_consent: z.boolean().optional(),
});

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
  const client = await getClient(ctx.params.id);
  if (!client) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Client not found" } },
      { status: 404 },
    );
  }
  const connectors = await getConnectorStatus(ctx.params.id);
  return NextResponse.json({ ok: true, data: { client, connectors } });
}

export async function PATCH(
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
    body = UpdateClientBody.parse(await req.json());
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
  try {
    const client = await updateClient(ctx.params.id, {
      ...body,
      updated_by: access.user?.id ?? null,
    });
    return NextResponse.json({ ok: true, data: { client } });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "UPDATE_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}
