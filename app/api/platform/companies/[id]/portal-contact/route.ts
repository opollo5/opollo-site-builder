import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// PUT /api/platform/companies/[id]/portal-contact
//
// Update portal_contact_email and portal_contact_name on platform_companies.
// Gate: manage_connections (admin). Both fields are optional and nullable.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  portal_contact_email: z.string().email().nullable().optional(),
  portal_contact_name:  z.string().max(200).nullable().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: companyId } = await params;

  const gate = await requireCanDoForApi(companyId, "manage_connections");
  if (gate.kind === "deny") return gate.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body is required.");
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request.", { issues: parsed.error.issues });
  }

  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("platform_companies")
    .update({
      portal_contact_email: parsed.data.portal_contact_email ?? null,
      portal_contact_name:  parsed.data.portal_contact_name  ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);

  if (error) {
    return internalError(`Failed to update portal contact: ${error.message}`);
  }

  return NextResponse.json(
    { ok: true, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
