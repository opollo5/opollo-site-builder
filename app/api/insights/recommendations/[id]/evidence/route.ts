import { type NextRequest, NextResponse } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { notFound } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json(
      { ok: false, error: { message: "company_id is required" } },
      { status: 400 },
    );
  }

  const gate = await requireCanDoForApi(companyId, "view_insights");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();

  // Verify rec belongs to this company
  const { data: rec, error: recErr } = await svc
    .from("ins_recommendations")
    .select("id, company_id, recommendation_type, headline")
    .eq("id", params.id)
    .single();

  if (recErr || !rec) return notFound("Recommendation not found");
  if (rec.company_id !== companyId) return notFound("Recommendation not found");

  const { data: evidence, error: evErr } = await svc
    .from("ins_recommendation_evidence")
    .select("id, source_table, source_row_ref, summary")
    .eq("recommendation_id", params.id)
    .order("created_at", { ascending: true });

  if (evErr) {
    return NextResponse.json({ ok: false, error: { message: evErr.message } }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    recommendation: {
      id: rec.id,
      recommendation_type: rec.recommendation_type,
      headline: rec.headline,
    },
    evidence: evidence ?? [],
  });
}
