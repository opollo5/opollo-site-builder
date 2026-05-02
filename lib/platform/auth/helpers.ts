import type { SupabaseClient } from "@supabase/supabase-js";

import { createRouteAuthClient } from "@/lib/auth";

import type { CompanyRole } from "./types";

// Thin TypeScript wrappers around the SQL helpers in migration 0070:
//   is_opollo_staff()   is_company_member(uuid)
//   has_company_role(uuid, role)   current_user_company()
//
// Each wrapper accepts an optional SupabaseClient so tests can pass a
// JWT-bearer client built from a seeded auth user. Production callers
// (route handlers, server actions) omit the parameter and get a
// cookie-bound client via createRouteAuthClient(). The SQL helpers all
// rely on auth.uid() — the client must carry a valid session for them to
// resolve correctly.
//
// All wrappers return false / null on RPC error rather than throwing.
// The SQL helpers themselves never raise (they COALESCE NULL → false);
// errors here mean a connectivity / RLS / arg-shape problem that should
// not crash a permission check. Callers that need to distinguish "denied"
// from "RPC failed" should call the underlying RPC directly.

export async function isOpolloStaff(client?: SupabaseClient): Promise<boolean> {
  const supabase = client ?? createRouteAuthClient();
  const { data, error } = await supabase.rpc("is_opollo_staff");
  if (error) return false;
  return data === true;
}

export async function isCompanyMember(
  companyId: string,
  client?: SupabaseClient,
): Promise<boolean> {
  const supabase = client ?? createRouteAuthClient();
  const { data, error } = await supabase.rpc("is_company_member", {
    company: companyId,
  });
  if (error) return false;
  return data === true;
}

export async function hasCompanyRole(
  companyId: string,
  minRole: CompanyRole,
  client?: SupabaseClient,
): Promise<boolean> {
  const supabase = client ?? createRouteAuthClient();
  const { data, error } = await supabase.rpc("has_company_role", {
    company: companyId,
    min_role: minRole,
  });
  if (error) return false;
  return data === true;
}

export async function currentUserCompanyId(
  client?: SupabaseClient,
): Promise<string | null> {
  const supabase = client ?? createRouteAuthClient();
  const { data, error } = await supabase.rpc("current_user_company");
  if (error || data == null) return null;
  return typeof data === "string" ? data : null;
}
