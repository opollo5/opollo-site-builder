import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentPlatformSession } from "@/lib/platform/auth";

// /company/social/* — session + company guard.
//
// The sidebar shell and page chrome live in app/company/layout.tsx.
// This layout only enforces that the visitor has a company context;
// Opollo staff without one are sent back to the admin panel.

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
      redirect("/admin/companies");
    }
    redirect("/company");
  }

  return <>{children}</>;
}
