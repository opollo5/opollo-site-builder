import { PlatformCompanyCreateForm } from "@/components/PlatformCompanyCreateForm";
import { TForm } from "@/templates";

// P3-2 — Opollo admin "create company" page. Server-rendered shell;
// the form posts to POST /api/admin/companies. Gated by
// app/admin/layout.tsx's checkAdminAccess (operator-side).

export const dynamic = "force-dynamic";

export default function NewCompanyPage() {
  return (
    <TForm
      title="New company"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Companies", href: "/admin/companies" },
        { label: "New" },
      ]}
      subtitle="Create a customer company. The first admin will be invited separately from the company detail page."
      formSections={[{ content: <PlatformCompanyCreateForm /> }]}
    />
  );
}
