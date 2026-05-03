import { redirect } from "next/navigation";

import { CustomerBrandProfileEditor } from "@/components/CustomerBrandProfileEditor";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getActiveBrandProfile } from "@/lib/platform/brand";
import { getPlatformCompany } from "@/lib/platform/companies";

// P-Brand-1c — Customer brand profile editor. Replaces the read-only
// view from P-Brand-1a now that the PATCH API (P-Brand-1b) is in place.
// Mirrors the gate pattern in app/company/users/page.tsx:
//
//   1. No session → redirect to /login.
//   2. Authenticated but no platform_users row → "Not provisioned".
//   3. Customer non-admin → "Admins only" notice. Brand profile is
//      configuration that controls every product's output, so admin-
//      gated mirrors the user-management gate.
//   4. Opollo staff → also allowed.

export const dynamic = "force-dynamic";

export default async function CompanyBrandPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/settings/brand")}`);
  }

  if (!session.company) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
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
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-medium">Admins only.</p>
        <p className="mt-1">
          Only admins can view and edit the brand profile. Ask an admin
          in your company to update your role if you need access.
        </p>
      </div>
    );
  }

  const companyId = session.company.companyId;

  const [companyResult, brand] = await Promise.all([
    getPlatformCompany(companyId),
    getActiveBrandProfile(companyId),
  ]);

  if (!companyResult.ok) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load company: {companyResult.error.message}
      </div>
    );
  }

  return (
    <CustomerBrandProfileEditor
      company={companyResult.data.company}
      brand={brand}
    />
  );
}
