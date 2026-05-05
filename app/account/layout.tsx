import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  AdminSidebar,
  SIDEBAR_COLLAPSED_COOKIE,
} from "@/components/AdminSidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { DebugFooter } from "@/components/DebugFooter";
import { Toaster } from "@/components/ui/toaster";
import { checkAdminAccess } from "@/lib/admin-gate";

// Shared shell for /account/* (devices, security). Mirrors AdminLayout
// so the operator surfaces feel like part of the same product instead
// of dropping out into bare unstyled pages mid-flow.
//
// UAT (2026-05-02) — Steven flagged that /auth/accept-invite +
// /account/devices + /account/security all lacked the admin chrome
// (sidebar / header), so a click on "Trusted devices" from the admin
// sidebar would dump the operator into a stark single-column layout.
// The auth/accept-invite page is intentionally chrome-less (pre-login),
// but /account/* is post-login and should match.
//
// Role gate: /account/* is reachable by any signed-in user, including
// non-admin tiers (operator, viewer). We use checkAdminAccess with
// requiredRoles widened to "any signed-in user" — passing all four
// known roles. If FEATURE_SUPABASE_AUTH is off, no gate fires and the
// chrome renders unconditionally.

export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}) {
  // /account/* is reachable by any signed-in user. Migration 0057
  // collapsed the legacy operator/viewer tiers into super_admin /
  // admin / user — passing all three keeps the gate honest.
  const access = await checkAdminAccess({
    requiredRoles: ["super_admin", "admin", "user"],
    insufficientRoleRedirectTo: "/login",
  });
  if (access.kind === "redirect") redirect(access.to);

  const user = access.user;

  // Reuse the same role-aware nav rules as AdminLayout. Non-admin
  // operators see fewer top-level entries; super_admin sees the
  // additional "Admin" section. /account/* itself is reachable in
  // both cases via the bottom-of-rail links.
  const isAdminTier =
    !user || user.role === "admin" || user.role === "super_admin";
  const isSuperAdmin = !user || user.role === "super_admin";

  const initialCollapsed =
    cookies().get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";

  return (
    <div className="min-h-screen bg-canvas text-foreground sm:flex">
      <a
        href="#account-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <AdminSidebar
        user={user}
        isAdminTier={isAdminTier}
        isSuperAdmin={isSuperAdmin}
        initialCollapsed={initialCollapsed}
      />
      <main
        id="account-main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 py-6 scroll-mt-16 focus:outline-none sm:px-8 sm:py-8"
      >
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
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
    </div>
  );
}
