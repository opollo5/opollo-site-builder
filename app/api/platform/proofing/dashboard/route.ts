import { NextResponse, type NextRequest } from "next/server";

import { validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getProofDashboard } from "@/lib/platform/proofing/engine";

// ---------------------------------------------------------------------------
// GET /api/platform/proofing/dashboard?company_id=...
//
// Returns Pending + Stuck proof dashboard data.
// Pending: open proofs with step and pending reviewers.
// Stuck: expired/overdue proofs.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const company_id = req.nextUrl.searchParams.get("company_id");
  if (!company_id) return validationError("company_id is required.");

  const gate = await requireCanDoForApi(company_id, "approve_post");
  if (gate.kind === "deny") return gate.response;

  const { pending, stuck } = await getProofDashboard(company_id);

  return NextResponse.json(
    { ok: true, data: { pending, stuck }, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
