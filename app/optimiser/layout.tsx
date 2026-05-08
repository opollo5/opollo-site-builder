import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { NavShell, type NavUserContext } from "@/components/nav/nav-shell";
import { Toaster } from "@/components/ui/toaster";

export default async function OptimiserLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  const user = access.user;
  const isAdminTier =
    !user || user.role === "admin" || user.role === "super_admin";

  const navContext: NavUserContext = {
    email: user?.email ?? null,
    role: user?.role ?? null,
    isOpolloStaff: isAdminTier,
    isCompanyAdmin: isAdminTier,
    companyId: null,
    companyName: null,
  };

  return (
    <>
      <NavShell
        navContext={navContext}
        skipToId="optimiser-main"
      >
        {children}
      </NavShell>
      <Toaster />
    </>
  );
}
