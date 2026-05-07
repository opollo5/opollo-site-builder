import { cookies } from "next/headers";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createRouteAuthClient } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase";

import type {
  CompanyMembership,
  CompanyRole,
  PlatformSession,
} from "./types";

// Cookie that Opollo staff can set to "view as" a specific company without
// permanently joining it. Staff still retain is_opollo_staff=true.
export const STAFF_SELECTED_COMPANY_COOKIE = "opollo_selected_company_id";

// Resolves the current platform-layer session: identity from auth.users via
// the cookie-bound client, then platform_users + platform_company_users via
// service-role (RLS bypass — same pattern as lib/auth.getCurrentUser).
//
// Returns null when:
//   - There is no session cookie / the JWT has expired.
//   - The authenticated user has no platform_users row yet (e.g. they
//     completed Supabase Auth signup but haven't accepted a platform
//     invitation — invariant: a platform user only exists after
//     invitation acceptance, P2).
//
// `client` is optional for test plumbing; production callers omit it and
// get the cookie-bound client. Tests pass a JWT-bearer client.

export async function getCurrentPlatformSession(
  client?: SupabaseClient,
): Promise<PlatformSession | null> {
  const supabase = client ?? createRouteAuthClient();
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) return null;

  const userId = userResp.user.id;
  const email = userResp.user.email ?? "";

  const svc = getServiceRoleClient();

  const profileResult = await svc
    .from("platform_users")
    .select("is_opollo_staff")
    .eq("id", userId)
    .maybeSingle();

  if (profileResult.error) return null;

  // Auto-provision: design intent (types.ts) is that Opollo operators have BOTH
  // an opollo_users row AND a platform_users row with is_opollo_staff=true.
  // When the platform_users row is missing (e.g. operator never manually seeded),
  // check opollo_users and create the missing row rather than redirecting to /login.
  if (!profileResult.data) {
    const opolloResult = await svc
      .from("opollo_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (opolloResult.error || !opolloResult.data) return null;

    // UPSERT is safe against concurrent first-access requests.
    await svc
      .from("platform_users")
      .upsert({ id: userId, email, is_opollo_staff: true }, { onConflict: "id" });

    // No company membership by default for auto-provisioned staff; cookie override applies.
    const cookieCompany = await resolveStaffSelectedCompany(svc);
    return { userId, email, isOpolloStaff: true, company: cookieCompany };
  }

  const membershipResult = await svc
    .from("platform_company_users")
    .select("company_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipResult.error) return null;

  let company: CompanyMembership | null = membershipResult.data
    ? {
        companyId: membershipResult.data.company_id as string,
        role: membershipResult.data.role as CompanyRole,
      }
    : null;

  // Staff can override their company context via cookie (view-as).
  if (profileResult.data.is_opollo_staff === true) {
    const cookieCompany = await resolveStaffSelectedCompany(svc);
    if (cookieCompany) company = cookieCompany;
  }

  return {
    userId,
    email,
    isOpolloStaff: profileResult.data.is_opollo_staff === true,
    company,
  };
}

export async function getCurrentCompany(
  client?: SupabaseClient,
): Promise<CompanyMembership | null> {
  const session = await getCurrentPlatformSession(client);
  return session?.company ?? null;
}

// Reads the staff company-selection cookie and validates the company exists.
// Returns a synthetic admin-role membership so Opollo staff can browse any
// company's portal without permanently joining it.
async function resolveStaffSelectedCompany(
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<CompanyMembership | null> {
  let selectedId: string | undefined;
  try {
    selectedId = cookies().get(STAFF_SELECTED_COMPANY_COOKIE)?.value;
  } catch {
    // cookies() throws outside of a request context (e.g. during tests).
    return null;
  }
  if (!selectedId || !/^[0-9a-f-]{36}$/i.test(selectedId)) return null;

  const result = await svc
    .from("platform_companies")
    .select("id")
    .eq("id", selectedId)
    .maybeSingle();

  if (result.error || !result.data) return null;

  return {
    companyId: selectedId,
    role: "admin",
  };
}
