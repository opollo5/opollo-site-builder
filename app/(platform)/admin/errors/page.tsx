import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { ClientErrorsTable } from "@/components/admin/errors/ClientErrorsTable";

export const dynamic = "force-dynamic";

interface ClientErrorRow {
  id: string;
  trace_id: string;
  company_id: string | null;
  surface: string;
  error_code: string;
  severity: string;
  message: string | null;
  context: Record<string, unknown> | null;
  resolved_at: string | null;
  created_at: string;
}

async function fetchErrors(): Promise<ClientErrorRow[]> {
  const db = getServiceRoleClient();
  const { data } = await db
    .from("client_errors")
    .select("id, trace_id, company_id, surface, error_code, severity, message, context, resolved_at, created_at")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  return (data ?? []) as ClientErrorRow[];
}

export default async function AdminErrorsPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
    insufficientRoleRedirectTo: "/",
  });
  if (access.kind === "redirect") redirect(access.to);

  const errors = await fetchErrors();

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Client errors" },
          ]}
        />
        <PageHeader.Title>Client errors</PageHeader.Title>
        <PageHeader.Subtitle>
          Unresolved errors from the composer and AI assistant. Ordered by most
          recent. Mark as resolved to remove from this view.
        </PageHeader.Subtitle>
      </PageHeader>

      <div
        className="mt-6 rounded-md border border-border"
        data-testid="client-errors-table-container"
      >
        {errors.length === 0 ? (
          <p
            className="px-6 py-8 text-center text-sm text-muted-foreground"
            data-testid="client-errors-empty"
          >
            No unresolved client errors.
          </p>
        ) : (
          <ClientErrorsTable errors={errors} />
        )}
      </div>
    </PageShell>
  );
}
