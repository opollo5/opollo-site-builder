// Barrel export for the platform-layer auth module. Routes, lib helpers,
// and tests should import from "@/lib/platform/auth" — never from a
// sub-path. This keeps the surface area visible in one place when V2
// changes the role model or adds an action.

import type { SupabaseClient } from "@supabase/supabase-js";

import { hasCompanyRole, isOpolloStaff } from "./helpers";
import { minRoleFor } from "./permissions";
import type { PermissionAction } from "./types";

export {
  isOpolloStaff,
  isCompanyMember,
  hasCompanyRole,
  currentUserCompanyId,
} from "./helpers";

export {
  getCurrentPlatformSession,
  getCurrentCompany,
} from "./current-user";

export { minRoleFor, roleSatisfies } from "./permissions";

export type {
  CompanyRole,
  PermissionAction,
  CompanyMembership,
  PlatformSession,
} from "./types";

// Composed permission check: does the current user satisfy this action in
// this company? Opollo staff bypass the role check (they can act in any
// company for support). Customer users are evaluated against the action's
// minimum role threshold via has_company_role.
//
// `client` is optional — test plumbing only.
export async function canDo(
  companyId: string,
  action: PermissionAction,
  client?: SupabaseClient,
): Promise<boolean> {
  if (await isOpolloStaff(client)) return true;
  return hasCompanyRole(companyId, minRoleFor(action), client);
}
