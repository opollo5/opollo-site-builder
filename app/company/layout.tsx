import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { NavShell, type NavUserContext } from "@/components/nav/nav-shell";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

export default async function CompanyLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company")}`);
  }

  const isAdmin =
    session.isOpolloStaff || session.company?.role === "admin";

  // Fetch company name for the nav context.
  let companyName: string | null = null;
  if (session.company?.companyId) {
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("platform_companies")
      .select("name")
      .eq("id", session.company.companyId)
      .maybeSingle();
    companyName = (data as { name: string } | null)?.name ?? null;
  }

  const navContext: NavUserContext = {
    email: session.email,
    role: session.isOpolloStaff ? "admin" : "user",
    isOpolloStaff: session.isOpolloStaff,
    isCompanyAdmin: isAdmin,
    companyId: session.company?.companyId ?? null,
    companyName,
  };

  return (
    <>
      <NavShell
        navContext={navContext}
        skipToId="company-main"
      >
        {children}
      </NavShell>
      <Toaster />
    </>
  );
}
