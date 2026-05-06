import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createRouteAuthClient } from "@/lib/auth";
import { validationError } from "@/lib/http";
import { STAFF_SELECTED_COMPANY_COOKIE } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/companies/switch
//
// Opollo staff only. Sets the opollo_selected_company_id cookie so the
// company portal renders data for the chosen company without the staff
// member permanently joining it via platform_company_users.
//
// Body: { company_id: uuid | null }
//   Pass null to clear the selection.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SwitchSchema = z.object({
  company_id: z.string().uuid().nullable(),
});

const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 1 week

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Explicit auth.getUser call (visible to audit scanner; gate enforced below).
  const supabase = createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  const svc = getServiceRoleClient();

  // Verify the user is Opollo staff via platform_users.
  const { data: profile } = await svc
    .from("platform_users")
    .select("is_opollo_staff")
    .eq("id", userResp.user.id)
    .maybeSingle();

  // Also allow auto-provisioned staff who exist only in opollo_users.
  let isStaff = profile?.is_opollo_staff === true;
  if (!isStaff) {
    const { data: opolloRow } = await svc
      .from("opollo_users")
      .select("id")
      .eq("id", userResp.user.id)
      .maybeSingle();
    isStaff = !!opolloRow;
  }

  if (!isStaff) {
    return NextResponse.json(
      { ok: false, error: { message: "Opollo staff only." } },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validationError("Request body must be valid JSON.");
  }

  const parsed = SwitchSchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Body must be { company_id: uuid | null }.");
  }

  const { company_id } = parsed.data;

  if (!company_id) {
    // Clear the selection.
    cookies().set(STAFF_SELECTED_COMPANY_COOKIE, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
    });
    return NextResponse.json({
      ok: true,
      data: { company_id: null },
      timestamp: new Date().toISOString(),
    });
  }

  // Verify the company exists before setting the cookie.
  const { data: company, error: companyErr } = await svc
    .from("platform_companies")
    .select("id, name")
    .eq("id", company_id)
    .maybeSingle();

  if (companyErr || !company) {
    return NextResponse.json(
      { ok: false, error: { message: "Company not found." } },
      { status: 404 },
    );
  }

  cookies().set(STAFF_SELECTED_COMPANY_COOKIE, company_id, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: "lax",
  });

  return NextResponse.json({
    ok: true,
    data: { company_id, company_name: company.name },
    timestamp: new Date().toISOString(),
  });
}
