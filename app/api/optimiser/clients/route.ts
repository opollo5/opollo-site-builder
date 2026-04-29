import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { checkAdminAccess } from "@/lib/admin-gate";
import { createClient as createOptClient, listClients } from "@/lib/optimiser/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateClientBody = z.object({
  name: z.string().min(1).max(120),
  primary_contact_email: z.string().email().optional(),
  client_slug: z.string().min(2).max(41),
  hosting_mode: z
    .enum(["opollo_subdomain", "opollo_cname", "client_slice"])
    .optional(),
  hosting_cname_host: z.string().optional(),
  llm_monthly_budget_usd: z.number().int().min(0).max(10000).optional(),
  cross_client_learning_consent: z.boolean().optional(),
});

export async function GET(): Promise<NextResponse> {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  const clients = await listClients();
  return NextResponse.json({ ok: true, data: { clients } });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["admin", "operator"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      { ok: false, error: { code: "UNAUTHORIZED", message: "Not authorised" } },
      { status: 401 },
    );
  }
  let body;
  try {
    body = CreateClientBody.parse(await req.json());
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
    const client = await createOptClient({
      ...body,
      created_by: access.user?.id ?? null,
    });
    return NextResponse.json({ ok: true, data: { client } }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const slugConflict = message.includes("opt_clients_slug_active_uniq");
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: slugConflict ? "SLUG_CONFLICT" : "CREATE_FAILED",
          message: slugConflict
            ? "client_slug already in use by another active client"
            : message,
        },
      },
      { status: slugConflict ? 409 : 500 },
    );
  }
}
