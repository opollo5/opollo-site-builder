import type { AdminUserRow } from "@/app/api/admin/users/list/route";
import { UserRoleActionCell } from "@/components/UserRoleActionCell";

// Users table for /admin/users. Server component for the shell + static
// cells; the role <select> is a client island so the action stays
// interactive without forcing the whole table client-side.

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
   * ID of the currently-signed-in admin, when known. Used by the role
   * action cell to disable self-modification. `null` under flag-off /
   * kill-switch (no Supabase identity); the server-side guard still
   * enforces the rest.
   */
  currentUserId: string | null;
}) {
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
            <tr key={u.id} className="border-b last:border-b-0 align-top">
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
                <UserRoleActionCell
                  userId={u.id}
                  currentRole={u.role}
                  selfUserId={currentUserId}
                />
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
