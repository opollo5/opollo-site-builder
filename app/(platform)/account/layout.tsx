import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { CommandPalette } from "@/components/CommandPalette";

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

  return (
    <>
      {children}
      <CommandPalette />
    </>
  );
}
