import { PlatformCompanyCreateForm } from "@/components/PlatformCompanyCreateForm";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";

// P3-2 — Opollo admin "create company" page. Server-rendered shell;
// the form posts to POST /api/admin/companies. Gated by
// app/admin/layout.tsx's checkAdminAccess (operator-side).

export const dynamic = "force-dynamic";

export default function NewCompanyPage() {
  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Companies", href: "/admin/companies" },
            { label: "New" },
          ]}
        />
        <PageHeader.Title>New company</PageHeader.Title>
        <PageHeader.Subtitle>
          Create a customer company. The first admin will be invited
          separately from the company detail page.
        </PageHeader.Subtitle>
      </PageHeader>
      <PlatformCompanyCreateForm />
    </PageShell>
  );
}
