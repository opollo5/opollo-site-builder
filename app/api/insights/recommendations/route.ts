import { type NextRequest, NextResponse } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { validationError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  const platform = searchParams.get("platform");
  const limitRaw = searchParams.get("limit") ?? "10";
  const limit = parseInt(limitRaw, 10);

  if (!companyId) return validationError("company_id is required");
  if (!platform || !["LINKEDIN", "FACEBOOK"].includes(platform)) {
    return validationError("platform must be LINKEDIN or FACEBOOK");
  }
  if (isNaN(limit) || limit < 1 || limit > 50) {
    return validationError("limit must be between 1 and 50");
  }

  const gate = await requireCanDoForApi(companyId, "view_insights");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("ins_recommendations")
    .select(
      "id, recommendation_type, headline, body, confidence_band, confidence_score, generated_at, evidence_refs",
    )
    .eq("company_id", companyId)
    .eq("platform", platform)
    .eq("suppressed", false)
    .gt("expires_at", new Date().toISOString())
    .in("confidence_band", ["strong", "moderate"])
    .order("confidence_score", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: { message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recommendations: data ?? [] });
}
