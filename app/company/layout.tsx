import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { CompanyTopNav } from "@/components/CompanyTopNav";
import { NotificationBell } from "@/components/NotificationBell";
import { Toaster } from "@/components/ui/toaster";
import { getCurrentPlatformSession } from "@/lib/platform/auth";

// ---------------------------------------------------------------------------
// /company — outer shell layout.
//
// Provides the full-page chrome (skip link, sticky brand header, Toaster)
// for all /company/* routes. The /company/social/* sub-layout adds its own
// secondary tab strip beneath this header; it must NOT duplicate the outer
// min-h-screen wrapper, skip link, or NotificationBell.
// ---------------------------------------------------------------------------

export default async function CompanyLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company")}`);
  }

  const companyId = session.company?.companyId ?? null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-2">
          <span className="mr-3 shrink-0 text-sm font-semibold tracking-tight">
            Opollo
          </span>
          <CompanyTopNav />
          <div className="ml-auto">
            {companyId ? (
              <NotificationBell companyId={companyId} />
            ) : null}
          </div>
        </div>
      </header>
      <div
        id="main-content"
        tabIndex={-1}
        className="scroll-mt-14 focus:outline-none"
      >
        {children}
      </div>
      <Toaster />
    </div>
  );
}
