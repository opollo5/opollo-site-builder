import type { SupabaseClient } from "@supabase/supabase-js";

import { createRouteAuthClient } from "@/lib/auth";
import { getServiceRoleClient } from "@/lib/supabase";

import type {
  CompanyMembership,
  CompanyRole,
  PlatformSession,
} from "./types";

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

  if (profileResult.error || !profileResult.data) return null;

  const membershipResult = await svc
    .from("platform_company_users")
    .select("company_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipResult.error) return null;

  const company: CompanyMembership | null = membershipResult.data
    ? {
        companyId: membershipResult.data.company_id as string,
        role: membershipResult.data.role as CompanyRole,
      }
    : null;

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
