import { redirect } from "next/navigation";

import { InviteUserButton } from "@/components/InviteUserButton";
import { H1 } from "@/components/ui/typography";
import { UsersTable } from "@/components/UsersTable";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import type { AdminUserRow } from "@/app/api/admin/users/list/route";

// ---------------------------------------------------------------------------
// /admin/users — M2d-1.
//
// Admin-only page listing every opollo_users row. Operators who follow
// a stale link are sent back to /admin/sites rather than all the way
// out to the chat builder; viewers never reach /admin/* at all because
// the layout gate filters them first.
//
// Reads via the service-role client — RLS is belt-and-braces here, the
// admin gate above is the actual access control.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["admin"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  // Under flag-off / kill-switch, `access.user` is null — the role
  // action cell treats null as "no self to compare against" and
  // enables every row. The server route still enforces the
  // last-admin guard.
  const currentUserId = access.user?.id ?? null;

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("opollo_users")
    .select("id, email, display_name, role, created_at, revoked_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <H1>Users</H1>
          <p className="text-sm text-muted-foreground">
            Everyone with access to this builder. Change a role inline; the
            server blocks self-modification and last-admin demotions.
          </p>
        </div>
        <InviteUserButton />
      </div>

      <div className="mt-6">
        {error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            Failed to load users: {error.message}
          </div>
        ) : (
          <UsersTable
            users={(data ?? []) as AdminUserRow[]}
            currentUserId={currentUserId}
          />
        )}
      </div>
    </>
  );
}
