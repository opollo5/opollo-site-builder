import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { NotificationBell } from "@/components/NotificationBell";
import { SocialNavClient } from "@/components/SocialNavClient";
import { getCurrentPlatformSession } from "@/lib/platform/auth";

// ---------------------------------------------------------------------------
// S1-26/S1-28 — shared nav shell for /company/social/*.
//
// Server component for session gate. Nav links are rendered by the
// SocialNavClient so usePathname() can highlight the active item.
// ---------------------------------------------------------------------------

export default async function CompanySocialLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.company) {
    redirect("/company");
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#social-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <nav
          className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-2"
          aria-label="Social navigation"
        >
          <Link
            href="/company"
            className="mr-3 shrink-0 text-sm font-semibold tracking-tight"
          >
            Opollo Social
          </Link>
          <SocialNavClient />
          <NotificationBell companyId={session.company.companyId} />
        </nav>
      </header>
      <div id="social-main" tabIndex={-1} className="scroll-mt-14 focus:outline-none">
        {children}
      </div>
    </div>
  );
}
