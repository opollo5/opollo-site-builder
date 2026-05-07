import { Building2 } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentPlatformSession } from "@/lib/platform/auth";

// /company/social/* — session + company guard.
//
// The sidebar shell and page chrome live in app/company/layout.tsx.
// This layout enforces that the visitor has a company context. For Opollo
// staff who haven't yet selected a company via the sidebar selector, we
// render an inline prompt rather than redirecting (the sidebar remains
// visible so they can pick a company immediately).

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
          <Building2 className="h-9 w-9 text-m3" aria-hidden />
          <p className="text-base font-medium">Select a company to continue</p>
          <p className="max-w-xs text-sm text-m3">
            Use the company selector in the sidebar to choose a client, then
            navigate here again.
          </p>
        </div>
      );
    }
    redirect("/company");
  }

  return <>{children}</>;
}
