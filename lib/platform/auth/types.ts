// Platform-layer auth types. Used across lib/platform/* and any route that
// gates on customer-company role. NOT to be confused with lib/auth.ts's
// SessionUser, which describes the existing Site Builder operator (opollo_users).
//
// The two systems coexist: Opollo staff have BOTH a row in opollo_users
// (operator role) AND a row in platform_users with is_opollo_staff=true.
// Customer users only have platform_users + platform_company_users.

export type CompanyRole = "admin" | "approver" | "editor" | "viewer";

// Every action a route can authorise. Stored as a string-literal union so
// the compiler catches typos at the call site. Add to this list and to the
// ACTION_MIN_ROLE map together — never one without the other.
export type PermissionAction =
  | "manage_users"
  | "edit_company_settings"
  | "manage_connections"
  | "reconnect_connection"
  | "manage_invitations"
  | "create_post"
  | "edit_post"
  | "submit_for_approval"
  | "approve_post"
  | "reject_post"
  | "schedule_post"
  | "view_calendar"
  | "receive_connection_alerts";

export type CompanyMembership = {
  companyId: string;
  role: CompanyRole;
};

export type PlatformSession = {
  userId: string;
  email: string;
  isOpolloStaff: boolean;
  // V1: a user belongs to exactly one company (or none, for Opollo staff).
  company: CompanyMembership | null;
};
