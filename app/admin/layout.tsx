import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { AdminNav } from "@/components/AdminNav";

// Shared shell for every page under /admin.
//
// M2c-2 added the auth gate: when FEATURE_SUPABASE_AUTH is on (and the
// kill switch is off), only admin/operator roles reach here; viewers
// get bounced to the chat builder, no-session callers to /login. The
// gate is defence-in-depth — middleware is the primary redirect path —
// but the layout is also where we need the user to render the header
// strip, so we call the same helper in one place.

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  const user = access.user;

  // The Users link is admin-only when the flag is on. Under flag-off /
  // kill-switch, `user` is null and the Basic Auth operator has root-
  // level trust already — show the link rather than break the admin
  // surface during a break-glass outage.
  const showUsersLink = !user || user.role === "admin";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminNav user={user} showUsersLink={showUsersLink} />
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
