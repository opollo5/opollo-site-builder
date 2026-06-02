import { NextResponse, type NextRequest } from "next/server";

import { validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getAuditTrail } from "@/lib/platform/proofing/engine";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/platform/proofing/[contentGroupId]/audit?company_id=...
//
// Returns the proof audit trail as JSON. Add ?format=csv for CSV export.
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

  const gate = await requireCanDoForApi(company_id, "approve_post");
  if (gate.kind === "deny") return gate.response;

  const events = await getAuditTrail(contentGroupId);

  const format = req.nextUrl.searchParams.get("format");
  if (format === "csv") {
    const header = "occurred_at,event_type,decision,step_order,step_name,actor_email,actor_name,version,comment\n";
    const rows = events
      .map((e) =>
        [
          e.occurred_at,
          e.event_type,
          e.decision ?? "",
          e.step_order ?? "",
          csvEscape(e.step_name ?? ""),
          csvEscape(e.actor_email ?? ""),
          csvEscape(e.actor_name ?? ""),
          e.version_number ?? "",
          csvEscape(e.comment ?? ""),
        ].join(","),
      )
      .join("\n");

    return new NextResponse(header + rows, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="proof-audit-${contentGroupId.slice(0, 8)}.csv"`,
      },
    });
  }

  return NextResponse.json(
    { ok: true, data: events, timestamp: new Date().toISOString() },
    { status: 200 },
  );
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
