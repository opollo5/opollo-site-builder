import type { ReactNode } from "react";
import { headers } from "next/headers";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";
import { NavShell, type NavUserContext } from "@/components/nav/nav-shell";
import { Toaster } from "@/components/ui/toaster";
import { BreadcrumbProvider } from "@/components/error-reporting/BreadcrumbProvider";
import { getCompanyTheme, buildThemeStyleBlock } from "@/lib/platform/theming";

// ---------------------------------------------------------------------------
// PlatformLayout — single shared authenticated layout that renders NavShell
// once for all platform routes (/admin, /company, /account, /optimiser).
//
// Placing NavShell here (rather than in each section layout) means the nav
// element never unmounts when the user navigates between sections — the DOM
// node persists and only the <main> content slot re-renders.
//
// Auth strategy:
//   - getCurrentPlatformSession — provides company context + isOpolloStaff
//   - getCurrentUser — provides the precise role (super_admin / admin / user)
//     from opollo_users, needed for requiresSuperAdmin nav filtering
//
// Both calls share the same Supabase client to avoid duplicate cookie reads.
// If either returns null (unauthenticated or feature flag off), the nav
// renders with a null context; section layouts enforce their own auth gates.
// ---------------------------------------------------------------------------

export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = createRouteAuthClient();

  // TODO(tech-debt): platform session + admin user are both fetched here AND
  // in each section layout's checkAdminAccess(). Unify once all sections share
  // a single auth boundary.
  const [platformSession, adminUser] = await Promise.all([
    getCurrentPlatformSession(supabase),
    getCurrentUser(supabase),
  ]);

  const isOpolloStaff = platformSession?.isOpolloStaff ?? false;

  // Only expose company context to /company/* routes — admin/account/optimiser
  // routes had explicit companyId: null in their pre-refactor layouts.
  const pathname = (await headers()).get("x-pathname") ?? "";
  const isCompanyRoute = pathname.startsWith("/company");

  let companyId: string | null = null;
  let companyName: string | null = null;
  let themeStyleBlock = "";
  if (isCompanyRoute && platformSession?.company?.companyId) {
    companyId = platformSession.company.companyId;
    const svc = getServiceRoleClient();
    const [nameResult, themeRow] = await Promise.all([
      svc.from("platform_companies").select("name").eq("id", companyId).maybeSingle(),
      getCompanyTheme(companyId),
    ]);
    companyName = (nameResult.data as { name: string } | null)?.name ?? null;
    if (themeRow) themeStyleBlock = buildThemeStyleBlock(themeRow.overrides);
  }

  const navContext: NavUserContext = {
    email: platformSession?.email ?? adminUser?.email ?? null,
    // adminUser.role is authoritative (from opollo_users); fall back for
    // platform-only users who have no opollo_users row.
    role:
      adminUser?.role ??
      (isOpolloStaff ? "admin" : null) ??
      (platformSession ? "user" : null),
    isOpolloStaff,
    isCompanyAdmin:
      isOpolloStaff || platformSession?.company?.role === "admin" || false,
    companyId,
    companyName,
  };

  return (
    <NavShell navContext={navContext}>
      {themeStyleBlock && (
        // Injects per-company CSS variable overrides. Only present when a
        // company has saved custom tokens — empty string skips the element.
        <style dangerouslySetInnerHTML={{ __html: themeStyleBlock }} />
      )}
      <BreadcrumbProvider />
      {children}
      <Toaster />
    </NavShell>
  );
}
