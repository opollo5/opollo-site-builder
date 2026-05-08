import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { NavShell, type NavUserContext } from "@/components/nav/nav-shell";
import { CommandPalette } from "@/components/CommandPalette";
import { DebugFooter } from "@/components/DebugFooter";
import { Toaster } from "@/components/ui/toaster";

// /account/* is reachable by any signed-in user. Mirrors admin chrome.

export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin", "user"],
    insufficientRoleRedirectTo: "/login",
  });
  if (access.kind === "redirect") redirect(access.to);

  const user = access.user;

  const isAdminTier =
    !user || user.role === "admin" || user.role === "super_admin";
  const isSuperAdmin = !user || user.role === "super_admin";

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
        skipToId="account-main"
      >
        {children}
      </NavShell>
      <Toaster />
      <CommandPalette />
      {isSuperAdmin && (
        <DebugFooter
          buildSha={process.env.VERCEL_GIT_COMMIT_SHA ?? null}
          vercelEnv={process.env.VERCEL_ENV ?? null}
          userEmail={user?.email ?? null}
          userRole={user?.role ?? null}
        />
      )}
    </>
  );
}
