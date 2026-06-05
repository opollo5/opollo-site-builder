import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { CommandPalette } from "@/components/CommandPalette";
import { SessionExpiryWatcher } from "@/components/session/session-expiry-watcher";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  return (
    <>
      {children}
      <CommandPalette />
      <SessionExpiryWatcher />
    </>
  );
}
