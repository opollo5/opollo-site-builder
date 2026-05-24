import { type NextRequest, NextResponse } from "next/server";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { notFound, validationError } from "@/lib/http";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const VALID_REASONS = ["not_relevant", "tried_before", "brand_mismatch", "other"] as const;
type DismissReason = (typeof VALID_REASONS)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body) return validationError("Invalid JSON body");

  const { reason, notes }: { reason: unknown; notes?: unknown } = body;
  if (!VALID_REASONS.includes(reason as DismissReason)) {
    return validationError("reason must be one of: not_relevant, tried_before, brand_mismatch, other");
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  if (!companyId) return validationError("company_id is required");

  const gate = await requireCanDoForApi(companyId, "manage_insights");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();

  const { data: rec, error: recErr } = await svc
    .from("ins_recommendations")
    .select("id, company_id, recommendation_type")
    .eq("id", params.id)
    .single();

  if (recErr || !rec) return notFound("Recommendation not found");
  if (rec.company_id !== companyId) return notFound("Recommendation not found");

  // Write dismissal memory row
  await svc.from("ins_client_memory").insert({
    company_id: companyId,
    memory_type: "dismissal",
    payload: {
      recommendation_type: rec.recommendation_type,
      recommendation_id: rec.id,
      reason: reason as string,
      notes: typeof notes === "string" ? notes : null,
      dismissed_by_user_id: gate.userId,
    },
  });

  // Count same-reason dismissals for this type
  const { count } = await svc
    .from("ins_client_memory")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("memory_type", "dismissal")
    .filter("payload->>recommendation_type", "eq", rec.recommendation_type)
    .filter("payload->>reason", "eq", reason as string)
    .is("deleted_at", null);

  // Three-strike: suppress all active recs of this type
  let suppressedAllOfType = false;
  if ((count ?? 0) >= 3) {
    await svc
      .from("ins_recommendations")
      .update({ suppressed: true })
      .eq("company_id", companyId)
      .eq("recommendation_type", rec.recommendation_type)
      .eq("suppressed", false);
    suppressedAllOfType = true;

    logger.info("ins.recommendations.suppressed", {
      companyId,
      type: rec.recommendation_type,
      strikeCount: count,
    });
  } else {
    await svc.from("ins_recommendations").update({ suppressed: true }).eq("id", params.id);
  }

  return NextResponse.json({ ok: true, suppressedAllOfType });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("company_id");
  if (!companyId) return validationError("company_id is required");

  const gate = await requireCanDoForApi(companyId, "manage_insights");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();

  const { data: rec, error: recErr } = await svc
    .from("ins_recommendations")
    .select("id, company_id")
    .eq("id", params.id)
    .single();

  if (recErr || !rec) return notFound("Recommendation not found");
  if (rec.company_id !== companyId) return notFound("Recommendation not found");

  await svc.from("ins_recommendations").update({ suppressed: false }).eq("id", params.id);

  return NextResponse.json({ ok: true });
}
