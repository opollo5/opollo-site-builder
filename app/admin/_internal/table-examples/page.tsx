import { redirect } from "next/navigation";

import { ExampleTablesClient } from "@/components/admin/internal/ExampleTablesClient";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { checkAdminAccess } from "@/lib/admin-gate";

// ---------------------------------------------------------------------------
// Spec 18 — DataTable visual reference page.
//
// Admin-only page rendering every state of the DataTable primitive:
// populated, empty, loading, with row actions, with row click, with
// selection, plus all six Pill variants.
//
// Not linked from main nav. Intended for:
//   1. Visual reference when migrating tables in PRs B/C/D.
//   2. Manual visual regression check after Spec 18-shaped changes.
//
// `_internal` segment makes the URL self-documenting as developer-only.
// Admin gate is the authorisation; the segment name is a hint to
// future contributors.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function TableExamplesPage() {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin"],
  });
  if (access.kind === "redirect") redirect(access.to);

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Internal", href: "/admin/_internal/table-examples" },
            { label: "Table examples" },
          ]}
        />
        <PageHeader.Title>DataTable examples</PageHeader.Title>
        <PageHeader.Subtitle>
          Visual reference for the canonical DataTable primitive (Spec 18).
          Admin-only.
        </PageHeader.Subtitle>
      </PageHeader>
      <ExampleTablesClient />
    </PageShell>
  );
}
