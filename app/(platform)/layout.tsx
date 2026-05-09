import type { ReactNode } from "react";

import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";
import { NavShell, type NavUserContext } from "@/components/nav/nav-shell";

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

  const [platformSession, adminUser] = await Promise.all([
    getCurrentPlatformSession(supabase),
    getCurrentUser(supabase),
  ]);

  let companyName: string | null = null;
  if (platformSession?.company?.companyId) {
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("platform_companies")
      .select("name")
      .eq("id", platformSession.company.companyId)
      .maybeSingle();
    companyName = (data as { name: string } | null)?.name ?? null;
  }

  const isOpolloStaff = platformSession?.isOpolloStaff ?? false;

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
    companyId: platformSession?.company?.companyId ?? null,
    companyName,
  };

  return (
    <NavShell navContext={navContext}>
      {children}
    </NavShell>
  );
}
