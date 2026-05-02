import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { H1, Lead } from "@/components/ui/typography";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { formatRelativeTime } from "@/lib/utils";

// AUTH-FOUNDATION P3.3 — /admin/users/audit.
//
// super_admin-only viewer of the user_audit_log table. Read-only,
// paginated (50/page). Joined with opollo_users to show actor email
// (the table only stores actor_id; resolving here keeps the storage
// row narrow).

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: { page?: string };
}

export default async function UserAuditPage({ searchParams }: PageProps) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin"],
    insufficientRoleRedirectTo: "/admin/users",
  });
  if (access.kind === "redirect") redirect(access.to);

  const pageNum = Math.max(1, Number(searchParams.page ?? "1"));
  const offset = (pageNum - 1) * PAGE_SIZE;

  const svc = getServiceRoleClient();
  const { data, error, count } = await svc
    .from("user_audit_log")
    .select(
      "id, action, target_email, metadata, created_at, actor:opollo_users!user_audit_log_actor_id_fkey(email)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const totalPages = count ? Math.max(1, Math.ceil(count / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <H1>User audit log</H1>
          <Lead className="mt-0.5">
            Append-only record of every user-management action.
            super_admin only.
          </Lead>
        </div>
        <Link
          href="/admin/users"
          className="rounded-md border px-3 py-2 text-sm transition-smooth hover:bg-muted"
        >
          ← Back to users
        </Link>
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-6" title="Failed to load audit log">
          {error.message}
        </Alert>
      ) : (
        <>
          <div className="mt-6 rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-sm uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Actor</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Target</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((row) => {
                  const actor = (row as unknown as {
                    actor?: { email?: string } | null;
                  }).actor;
                  return (
                    <tr
                      key={(row.id as number).toString()}
                      className="border-b align-top last:border-b-0"
                      data-testid="audit-row"
                    >
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        <span data-screenshot-mask>
                          {formatRelativeTime(row.created_at as string)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {actor?.email ?? "(deleted user)"}
                      </td>
                      <td className="px-3 py-2 text-sm font-medium">
                        {row.action as string}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {row.target_email as string}
                      </td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">
                        <code className="font-mono text-[11px]">
                          {JSON.stringify(row.metadata ?? {}, null, 0)}
                        </code>
                      </td>
                    </tr>
                  );
                })}
                {(data ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-sm text-muted-foreground"
                    >
                      No audit events yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Page {pageNum} of {totalPages} · {count} total events
              </span>
              <div className="flex gap-2">
                {pageNum > 1 && (
                  <Link
                    href={`/admin/users/audit?page=${pageNum - 1}`}
                    className="rounded border px-3 py-1 text-sm hover:bg-muted"
                  >
                    ← Previous
                  </Link>
                )}
                {pageNum < totalPages && (
                  <Link
                    href={`/admin/users/audit?page=${pageNum + 1}`}
                    className="rounded border px-3 py-1 text-sm hover:bg-muted"
                  >
                    Next →
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
