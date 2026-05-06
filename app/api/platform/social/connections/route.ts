import { NextResponse, type NextRequest } from "next/server";

import { validationError, internalError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { listConnections } from "@/lib/platform/social/connections";

// ---------------------------------------------------------------------------
// S1-12 — GET /api/platform/social/connections?company_id=...
//
// Returns the company's social_connections roster (one row per
// platform, currently 5 supported: linkedin_personal, linkedin_company,
// facebook_page, x, gbp). Gate: canDo("view_calendar", company_id).
//
// The bundle.social OAuth flow that ADDS connections lands in S1-13;
// this endpoint just surfaces what's already in the table.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return validationError("company_id query parameter (uuid) is required.");
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listConnections({ companyId });
  if (!result.ok) {
    if (result.error.code === "VALIDATION_FAILED") return validationError(result.error.message);
    return internalError(result.error.message);
  }

  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}
