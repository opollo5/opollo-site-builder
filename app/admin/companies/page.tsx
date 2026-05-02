import { PlatformCompaniesListClient } from "@/components/PlatformCompaniesListClient";
import { listPlatformCompanies } from "@/lib/platform/companies";

// P3-1 — Opollo admin companies list. Gated by app/admin/layout.tsx's
// checkAdminAccess (operator opollo_users.role IN super_admin/admin).
// Reads via service-role at request time; the platform_companies RLS
// would also allow opollo staff to read, but we go through service-role
// for consistency with the rest of /admin/* (no embed surprises).
//
// Future sub-slices in this directory:
//   - new/page.tsx       (P3-2: create company form)
//   - [id]/page.tsx      (P3-3: detail with members + invitations)
//   - [id]/invitations/  (P3-4: invite-from-detail flow)

export const dynamic = "force-dynamic";

export default async function AdminCompaniesPage() {
  const result = await listPlatformCompanies();
  if (!result.ok) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load companies: {result.error.message}
      </div>
    );
  }
  return <PlatformCompaniesListClient companies={result.data.companies} />;
}
