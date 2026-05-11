import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  internalError,
  notFound,
  parseBodyWith,
  readJsonBody,
  validateUuidParam,
  validationError,
} from "@/lib/http";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// Cross-tenant identity-leak defence — Layer 4 admin maintenance.
// Toggles platform_companies.allow_cross_tenant_identity. Audited.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({ value: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Body must be JSON.");
  const parsed = parseBodyWith(Schema, body);
  if (!parsed.ok) return parsed.response;

  const svc = getServiceRoleClient();
  const company = await svc
    .from("platform_companies")
    .select("id, name, allow_cross_tenant_identity")
    .eq("id", idCheck.value)
    .maybeSingle();
  if (company.error) return internalError(company.error.message);
  if (!company.data) return notFound("Company not found.");

  const previousValue = Boolean(
    (company.data as { allow_cross_tenant_identity?: boolean })
      .allow_cross_tenant_identity,
  );
  if (previousValue === parsed.data.value) {
    return NextResponse.json({
      ok: true,
      data: { value: previousValue, changed: false },
      timestamp: new Date().toISOString(),
    });
  }

  const update = await svc
    .from("platform_companies")
    .update({ allow_cross_tenant_identity: parsed.data.value })
    .eq("id", idCheck.value);
  if (update.error) {
    logger.error("admin.maintenance.toggle_override.failed", {
      company_id: idCheck.value,
      err: update.error.message,
    });
    return internalError(update.error.message);
  }

  await svc.from("platform_events").insert({
    event_type: "cross_tenant_override",
    company_id: idCheck.value,
    actor_id: gate.user?.id ?? null,
    entity_type: "platform_company",
    entity_id: idCheck.value,
    payload: {
      action: "toggle_allow_cross_tenant_identity",
      from: previousValue,
      to: parsed.data.value,
    },
  });

  return NextResponse.json({
    ok: true,
    data: { value: parsed.data.value, changed: true },
    timestamp: new Date().toISOString(),
  });
}
