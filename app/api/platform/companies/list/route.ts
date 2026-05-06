import { NextResponse, type NextRequest } from "next/server";

import { createRouteAuthClient } from "@/lib/auth";
import { internalError } from "@/lib/http";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { listPlatformCompanies } from "@/lib/platform/companies";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// GET /api/platform/companies/list
//
// Opollo staff: returns all companies (for the CompanySelector dropdown).
// Company members: returns only the company they belong to.
// Unauthenticated: 401.
//
// Used by CompanySidebar to populate the company-switcher dropdown.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // Explicit auth.getUser call (visible to audit scanner; guard below).
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  const session = await getCurrentPlatformSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  if (session.isOpolloStaff) {
    const result = await listPlatformCompanies();
    if (!result.ok) {
      return internalError(result.error.message);
    }
    return NextResponse.json({
      ok: true,
      data: {
        companies: result.data.companies.map((c) => ({
          id: c.id,
          name: c.name,
          domain: c.domain,
          is_opollo_internal: c.is_opollo_internal,
        })),
        selectedCompanyId: session.company?.companyId ?? null,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Non-staff: return only their own company.
  if (!session.company) {
    return NextResponse.json({
      ok: true,
      data: { companies: [], selectedCompanyId: null },
      timestamp: new Date().toISOString(),
    });
  }

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_companies")
    .select("id, name, domain, is_opollo_internal")
    .eq("id", session.company.companyId)
    .maybeSingle();

  if (error) {
    return internalError(`Failed to load company: ${error.message}`);
  }

  return NextResponse.json({
    ok: true,
    data: {
      companies: data
        ? [{ id: data.id, name: data.name, domain: data.domain, is_opollo_internal: data.is_opollo_internal }]
        : [],
      selectedCompanyId: session.company.companyId,
    },
    timestamp: new Date().toISOString(),
  });
}
