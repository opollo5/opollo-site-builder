import Link from "next/link";

import { FirstCustomerOnboardedMoment } from "@/components/onboarding/first-customer-onboarded-moment";
import { PlatformCompaniesListClient } from "@/components/PlatformCompaniesListClient";
import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { TListWide } from "@/templates";
import { listPlatformCompanies } from "@/lib/platform/companies";

// P3-1 — Opollo admin companies list. Gated by app/admin/layout.tsx's
// checkAdminAccess (operator opollo_users.role IN super_admin/admin).
// Reads via service-role at request time; the platform_companies RLS
// would also allow opollo staff to read, but we go through service-role
// for consistency with the rest of /admin/* (no embed surprises).

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminCompaniesPage({
  searchParams,
}: {
  searchParams?: { created?: string; name?: string };
}) {
  const breadcrumb = [
    { label: "Admin", href: "/admin/sites" },
    { label: "Companies" },
  ];

  const result = await listPlatformCompanies();
  if (!result.ok) {
    return (
      <TListWide title="Companies" breadcrumb={breadcrumb}>
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load companies: {result.error.message}
        </div>
      </TListWide>
    );
  }

  const companies = result.data.companies;
  const subtitle =
    companies.length === 0
      ? "No customer companies yet."
      : `${companies.length} ${companies.length === 1 ? "company" : "companies"} on the platform.`;

  return (
    <TListWide
      title="Companies"
      breadcrumb={breadcrumb}
      subtitle={subtitle}
      actions={
        <Button asChild data-testid="add-company-button">
          <Link href="/admin/companies/new">
            <NavIcon name="plus" size={16} />
            New company
          </Link>
        </Button>
      }
    >
      {searchParams?.created && (
        <div className="mb-6">
          <FirstCustomerOnboardedMoment
            companyId={searchParams.created}
            companyName={searchParams.name ?? "New customer"}
          />
        </div>
      )}
      <PlatformCompaniesListClient companies={companies} />
    </TListWide>
  );
}
