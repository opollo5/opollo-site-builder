import { redirect } from "next/navigation";

import { CustomerCompanyUsersView } from "@/components/CustomerCompanyUsersView";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getPlatformCompany } from "@/lib/platform/companies";

// P4 — Customer admin's view of their own company's users + pending
// invitations. Server-rendered. Gates:
//
//   1. No session → redirect to /login.
//   2. Authenticated but no platform_users row → "Not provisioned"
//      (typically an operator who hasn't accepted a customer invitation
//      themselves; not a real failure mode for V1).
//   3. Customer non-admin (approver / editor / viewer) → "Forbidden"
//      message. Admins-only manage users per the role table in
//      platform-customer-management skill.
//   4. Opollo staff → also allowed (they manage every customer company
//      from /admin/companies/[id], but the page is reachable for
//      diagnostic / shadow-impersonation work).

export const dynamic = "force-dynamic";

export default async function CompanyUsersPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/users")}`);
  }

  if (!session.company) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-base">
        <p className="font-medium">Account not provisioned to a company.</p>
        <p className="mt-1 text-muted-foreground">
          Your account isn&apos;t a member of any company on the platform
          yet. Ask an admin to invite you, or contact Opollo support.
        </p>
      </div>
    );
  }

  const isAdmin =
    session.isOpolloStaff || session.company.role === "admin";
  if (!isAdmin) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-base text-destructive">
        <p className="font-medium">Admins only.</p>
        <p className="mt-1">
          Only admins can manage company users. Ask an admin in your
          company to update your role if you need access.
        </p>
      </div>
    );
  }

  const detailResult = await getPlatformCompany(session.company.companyId);
  if (!detailResult.ok) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-base text-destructive"
        role="alert"
      >
        Failed to load company: {detailResult.error.message}
      </div>
    );
  }

  return <CustomerCompanyUsersView detail={detailResult.data} />;
}
