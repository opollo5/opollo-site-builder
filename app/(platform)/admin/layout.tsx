import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { CommandPalette } from "@/components/CommandPalette";
import { DebugFooter } from "@/components/DebugFooter";
import { SessionExpiryWatcher } from "@/components/session/session-expiry-watcher";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  const user = access.user;
  const isSuperAdmin = !user || user.role === "super_admin";

  return (
    <>
      {children}
      <CommandPalette />
      <SessionExpiryWatcher />
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
