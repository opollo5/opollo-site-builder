import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { AdminSidebar } from "@/components/AdminSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { Toaster } from "@/components/ui/toaster";

// Shared shell for every page under /admin.
//
// R1-1 — Switched from a top horizontal AdminNav to a left sidebar
// (AdminSidebar). Sidebar is pinned 240px on desktop, collapsible to
// 64px icon-only, and off-canvas on mobile. Page background is the
// canvas tint (--canvas) so the white card surfaces register against
// the rail.

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
    <div className="min-h-screen bg-canvas text-foreground sm:flex">
      {/* C-3 — skip-to-content link. Visually hidden until focused. */}
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <AdminSidebar user={user} showUsersLink={showUsersLink} />
      <main
        id="admin-main"
        tabIndex={-1}
        // R1-3 — content gutters: px-8 desktop / px-4 mobile per the
        // Linear pattern. py-8 desktop matches. min-w-0 prevents flex
        // children from forcing horizontal overflow.
        className="min-w-0 flex-1 px-4 py-6 scroll-mt-16 focus:outline-none sm:px-8 sm:py-8"
      >
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
      <Toaster />
      <CommandPalette />
    </div>
  );
}
