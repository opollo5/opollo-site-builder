import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { NavIcon } from "@/components/ui/nav-icon";
import { ComposerMount } from "@/components/composer/composer-mount";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

// /company/social/* — session + company guard.
//
// The nav shell lives in app/company/layout.tsx (NavShell).
// This layout enforces that the visitor has a company context. For Opollo
// staff who haven't yet selected a company via the Social section nav
// selector, we render an inline prompt rather than redirecting.
//
// Mounts PostComposerModal here so it is available on every social
// sub-route via ?compose=new or ?compose=<id>.

export default async function CompanySocialLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.company) {
    if (session.isOpolloStaff) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 text-center">
          <NavIcon name="apartment" size={36} className="text-tx-muted" />
          <p className="text-base font-medium">Select a company to continue</p>
          <p className="max-w-xs text-sm text-tx-muted">
            Use the company selector in the Social navigation panel to choose a
            client, then navigate here again.
          </p>
        </div>
      );
    }
    redirect("/company");
  }

  let companyTimezone = "UTC";
  const svc = getServiceRoleClient();
  const { data: tzRow } = await svc
    .from("platform_companies")
    .select("timezone")
    .eq("id", session.company.companyId)
    .maybeSingle();
  companyTimezone = (tzRow?.timezone as string | null) ?? "UTC";

  return (
    <>
      {children}
      <ComposerMount
        companyId={session.company.companyId}
        userId={session.userId}
        companyTimezone={companyTimezone}
      />
    </>
  );
}
