"use client";

import type { AdminUserRow } from "@/app/api/admin/users/list/route";
import { UserActionsMenu } from "@/components/UserActionsMenu";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";

// ---------------------------------------------------------------------------
// Spec 18 PR B — Users table migration.
//
// Replaces the bespoke <table> + inline role <select> + inline Revoke
// button with the canonical DataTable. Edit operations now live in the
// trailing `...` menu (UserActionsMenu) — same shape as Sites.
//
// Visual contract:
//
//   - Email     → TableCell.Stack (email + display_name).
//   - Role      → Pill (`accent` for super_admin, `info` for admin,
//                 `neutral` for user).
//   - Created   → TableCell.Secondary (formatted date).
//   - Status    → Pill (`success` for active, `neutral` for revoked).
//
// Removed: UserRoleActionCell (inline dropdown), UserStatusActionCell
// (inline button). Both are kept as exports in case any non-table
// surface still wants them — but the Users table no longer uses them.
// ---------------------------------------------------------------------------

type Role = "super_admin" | "admin" | "user";

const ROLE_VARIANT: Record<Role, PillVariant> = {
  super_admin: "accent",
  admin: "info",
  user: "neutral",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function UsersTable({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  /**
   * ID of the currently-signed-in admin, when known. Used by
   * UserActionsMenu to disable self-modification. `null` under flag-off
   * / kill-switch (no Supabase identity); the server-side guard still
   * enforces the rest.
   */
  currentUserId: string | null;
}) {
  const columns: ColumnDef<AdminUserRow>[] = [
    {
      key: "email",
      header: "Email",
      cell: (u) => (
        <TableCell.Stack
          primary={u.email}
          secondary={u.display_name ?? undefined}
        />
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (u) => (
        <Pill variant={ROLE_VARIANT[u.role as Role] ?? "neutral"}>{u.role}</Pill>
      ),
    },
    {
      key: "created",
      header: "Created",
      cell: (u) => <TableCell.Secondary>{formatDate(u.created_at)}</TableCell.Secondary>,
    },
    {
      key: "status",
      header: "Status",
      cell: (u) =>
        u.revoked_at !== null ? (
          <Pill variant="neutral">revoked</Pill>
        ) : (
          <Pill variant="success">active</Pill>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "40px",
      align: "right",
      cell: (u) => (
        <span onClick={(e) => e.stopPropagation()}>
          <UserActionsMenu
            userId={u.id}
            email={u.email}
            currentRole={u.role as Role}
            revoked={u.revoked_at !== null}
            selfUserId={currentUserId}
          />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data={users}
      columns={columns}
      rowKey={(u) => u.id}
      testId="users-table"
      emptyState={{
        icon: <NavIcon name="users" size={20} />,
        iconLabel: "No users",
        title: "No users yet",
        body: (
          <>
            The <code className="font-mono text-sm">first_admin_email</code>{" "}
            bootstrap promotes the first Supabase signup to admin; everyone
            else starts as user.
          </>
        ),
      }}
    />
  );
}
