import type { AdminUserRow } from "@/app/api/admin/users/list/route";

// Read-only users table. Server component: data is pre-fetched in the
// parent page. Action buttons (promote/demote/revoke) land in M2d-2+.

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

function RoleBadge({ role }: { role: AdminUserRow["role"] }) {
  const palette: Record<AdminUserRow["role"], string> = {
    admin: "bg-primary/10 text-primary",
    operator: "bg-secondary text-secondary-foreground",
    viewer: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${palette[role]}`}
    >
      {role}
    </span>
  );
}

export function UsersTable({ users }: { users: AdminUserRow[] }) {
  if (users.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No users yet. The `first_admin_email` bootstrap promotes the first
          Supabase signup to admin; everyone else starts as viewer.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Created</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b last:border-b-0">
              <td className="px-3 py-2">
                <div className="flex flex-col">
                  <span>{u.email}</span>
                  {u.display_name && (
                    <span className="text-xs text-muted-foreground">
                      {u.display_name}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">
                <RoleBadge role={u.role} />
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {formatDate(u.created_at)}
              </td>
              <td className="px-3 py-2">
                {u.revoked_at ? (
                  <span className="text-xs text-destructive">revoked</span>
                ) : (
                  <span className="text-xs text-muted-foreground">active</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
