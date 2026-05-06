import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import {
  CompanySidebar,
  COMPANY_SIDEBAR_COLLAPSED_COOKIE,
} from "@/components/CompanySidebar";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

export default async function CompanyLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company")}`);
  }

  const isAdmin =
    session.isOpolloStaff || session.company?.role === "admin";

  const initialCollapsed =
    cookies().get(COMPANY_SIDEBAR_COLLAPSED_COOKIE)?.value === "1";

  // Fetch company name for the sidebar header.
  let companyName: string | null = null;
  if (session.company?.companyId) {
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("platform_companies")
      .select("name")
      .eq("id", session.company.companyId)
      .maybeSingle();
    companyName = (data as { name: string } | null)?.name ?? null;
  }

  return (
    <div className="min-h-screen bg-canvas text-foreground sm:flex">
      <a
        href="#company-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <CompanySidebar
        email={session.email}
        isOpolloStaff={session.isOpolloStaff}
        isAdmin={isAdmin}
        companyId={session.company?.companyId ?? null}
        companyName={companyName}
        initialCollapsed={initialCollapsed}
      />
      <main
        id="company-main"
        tabIndex={-1}
        className="min-w-0 flex-1 px-4 py-6 scroll-mt-16 focus:outline-none sm:px-8 sm:py-8"
      >
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}
