import type { CompanyRole, PermissionAction } from "./types";

// Single source of truth for role hierarchy. admin > approver > editor > viewer.
// Higher rank = more privileges. Used to evaluate `hasCompanyRole(min_role)`
// in the SQL helper and to decide minimum-role thresholds for actions.
const ROLE_RANK: Record<CompanyRole, number> = {
  admin: 4,
  approver: 3,
  editor: 2,
  viewer: 1,
};

// Maps each action to the minimum role that may perform it. Mirrors the
// permission table in BUILD.md and the platform-customer-management skill.
// Keep this exhaustive — every PermissionAction must appear here, otherwise
// the TypeScript compiler will catch the gap at build time via the
// Record<PermissionAction, CompanyRole> shape.
const ACTION_MIN_ROLE: Record<PermissionAction, CompanyRole> = {
  manage_users: "admin",
  edit_company_settings: "admin",
  manage_connections: "admin",
  // S8: editors+ can reconnect an existing disconnected/auth_required
  // connection (re-OAuth on a credential that has expired). Creating new
  // connections and deleting connections remain admin-only via
  // manage_connections.
  reconnect_connection: "editor",
  manage_invitations: "admin",
  create_post: "editor",
  edit_post: "editor",
  submit_for_approval: "editor",
  approve_post: "approver",
  reject_post: "approver",
  schedule_post: "approver",
  view_calendar: "viewer",
  receive_connection_alerts: "admin",
  // S1-44: MSP (Opollo staff) release action. Admin is the customer-side
  // minimum; Opollo staff bypass the role check entirely via isOpolloStaff.
  release_post: "admin",
};

export function minRoleFor(action: PermissionAction): CompanyRole {
  return ACTION_MIN_ROLE[action];
}

// Returns true when `have` is at least as privileged as `need`. Mirrors the
// `has_company_role` SQL helper's comparison so app-side and DB-side
// decisions stay aligned.
export function roleSatisfies(have: CompanyRole, need: CompanyRole): boolean {
  return ROLE_RANK[have] >= ROLE_RANK[need];
}
