import { NextResponse, type NextRequest } from "next/server";

import { validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getVersionComparison } from "@/lib/platform/proofing/engine";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/platform/proofing/[contentGroupId]/versions?company_id=...
//
// Returns the full version chain for a content group for side-by-side comparison.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contentGroupId: string }> },
): Promise<NextResponse> {
  const { contentGroupId } = await params;
  const company_id = req.nextUrl.searchParams.get("company_id");
  if (!company_id) return validationError("company_id is required.");

  // Verify content group belongs to this company
  const svc = getServiceRoleClient();
  const { data: draft } = await svc
    .from("social_post_drafts")
    .select("id")
    .eq("content_group_id", contentGroupId)
    .eq("company_id", company_id)
    .limit(1)
    .maybeSingle();

  if (!draft) return validationError("Content group not found in this company.");

  const gate = await requireCanDoForApi(company_id, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const versions = await getVersionComparison(contentGroupId);

  return NextResponse.json(
    { ok: true, data: versions, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
