import { NextResponse, type NextRequest } from "next/server";

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

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const companyId = new URL(req.url).searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson(
      "VALIDATION_FAILED",
      "company_id query parameter (uuid) is required.",
      400,
    );
  }

  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listConnections({ companyId });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      result.error.code === "VALIDATION_FAILED" ? 400 : 500,
    );
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
