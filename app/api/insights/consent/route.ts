import { type NextRequest, NextResponse } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { validationError } from "@/lib/http";

export const dynamic = "force-dynamic";

const MSA_VERSION = "1.0";

export async function PUT(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validationError("Request body must be JSON");
  }

  if (typeof body !== "object" || body === null) {
    return validationError("Request body must be a JSON object");
  }

  const { company_id, cross_client_learning_consent, competitor_tracking_consent } = body as Record<
    string,
    unknown
  >;

  if (typeof company_id !== "string" || !company_id) {
    return validationError("company_id is required");
  }

  const gate = await requireCanDoForApi(company_id, "manage_insights");
  if (gate.kind === "deny") return gate.response;

  const updates: Record<string, unknown> = {};
  if (typeof cross_client_learning_consent === "boolean") {
    updates.cross_client_learning_consent = cross_client_learning_consent;
  }
  if (typeof competitor_tracking_consent === "boolean") {
    updates.competitor_tracking_consent = competitor_tracking_consent;
  }

  if (Object.keys(updates).length === 0) {
    return validationError(
      "At least one of cross_client_learning_consent or competitor_tracking_consent is required",
    );
  }

  const now = new Date().toISOString();
  updates.consented_at = now;
  updates.consented_by_user_id = gate.userId;
  updates.msa_version = MSA_VERSION;

  const svc = getServiceRoleClient();

  const { error } = await svc
    .from("ins_consent")
    .upsert({ company_id, ...updates }, { onConflict: "company_id" });

  if (error) {
    return NextResponse.json({ ok: false, error: { message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ ok: true, msa_version: MSA_VERSION, updated_at: now });
}
