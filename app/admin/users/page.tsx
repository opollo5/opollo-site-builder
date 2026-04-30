import Link from "next/link";
import { redirect } from "next/navigation";

import { InviteUserButton } from "@/components/InviteUserButton";
import { PendingInvitesTable } from "@/components/PendingInvitesTable";
import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { UsersTable } from "@/components/UsersTable";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import type { AdminUserRow } from "@/app/api/admin/users/list/route";

// ---------------------------------------------------------------------------
// /admin/users — M2d-1 + AUTH-FOUNDATION P3.3.
//
// P3.3 layered onto the existing M2d page:
//   - Pending invites section (read from `invites` table) with
//     per-row revoke action.
//   - Actor role threaded through to InviteUserButton so the modal
//     filters role-dropdown options (super_admin → admin/user;
//     admin → user only).
//   - Audit-log link (super_admin only) to /admin/users/audit.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

interface PendingInviteRow {
  id: string;
  email: string;
  role: "admin" | "user";
  invited_by_email: string | null;
  created_at: string;
  expires_at: string;
}

export default async function AdminUsersPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  const currentUserId = access.user?.id ?? null;
  const actorRole = access.user?.role ?? "admin";
  const isSuperAdmin = actorRole === "super_admin";

  const svc = getServiceRoleClient();

  const usersRes = await svc
    .from("opollo_users")
    .select("id, email, display_name, role, created_at, revoked_at")
    .order("created_at", { ascending: false });

  // Pending invites + their inviter email (joined via FK).
  const invitesRes = await svc
    .from("invites")
    .select(
      "id, email, role, created_at, expires_at, invited_by:opollo_users!invites_invited_by_fkey(email)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const pendingInvites: PendingInviteRow[] = (invitesRes.data ?? []).map(
    (row) => {
      const inviter = (row as unknown as { invited_by?: { email?: string } | null })
        .invited_by;
      return {
        id: row.id as string,
        email: row.email as string,
        role: row.role as "admin" | "user",
        invited_by_email: inviter?.email ?? null,
        created_at: row.created_at as string,
        expires_at: row.expires_at as string,
      };
    },
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H1>Users</H1>
          <Lead className="mt-0.5">
            {(usersRes.data ?? []).length === 0
              ? "No users yet."
              : `${(usersRes.data ?? []).length} ${(usersRes.data ?? []).length === 1 ? "user" : "users"} with access. Change a role inline; the server blocks self-modification, last-admin demotions, and any change to the super_admin row.`}
          </Lead>
        </div>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Link
              href="/admin/users/audit"
              className="rounded-md border px-3 py-2 text-sm transition-smooth hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="users-audit-link"
            >
              Audit log
            </Link>
          )}
          <InviteUserButton actorRole={actorRole} />
        </div>
      </div>

      {pendingInvites.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Pending invites · {pendingInvites.length}
          </h2>
          <PendingInvitesTable invites={pendingInvites} />
        </div>
      )}

      <div className="mt-6">
        {usersRes.error ? (
          <Alert variant="destructive" title="Failed to load users">
            {usersRes.error.message}
          </Alert>
        ) : (
          <>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">
              Active and revoked users · {(usersRes.data ?? []).length}
            </h2>
            <UsersTable
              users={(usersRes.data ?? []) as AdminUserRow[]}
              currentUserId={currentUserId}
            />
          </>
        )}
      </div>
    </>
  );
}
