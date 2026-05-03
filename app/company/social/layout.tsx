import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentPlatformSession } from "@/lib/platform/auth";

// ---------------------------------------------------------------------------
// S1-26 — shared nav shell for /company/social/*.
//
// Checks session + company membership at the layout level so individual
// pages don't need to handle the "no session" redirect themselves. Each
// page still validates company-specific state (canDo gates, etc.).
// ---------------------------------------------------------------------------

const NAV = [
  { href: "/company/social/posts", label: "Posts" },
  { href: "/company/social/calendar", label: "Calendar" },
  { href: "/company/social/connections", label: "Connections" },
  { href: "/company/social/media", label: "Media" },
  { href: "/company/social/sharing", label: "Sharing" },
];

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
          className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-6 py-2 text-sm"
          aria-label="Social navigation"
        >
          <Link
            href="/company"
            className="mr-3 shrink-0 font-semibold tracking-tight"
          >
            Opollo Social
          </Link>
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-md px-3 py-1.5 hover:bg-muted"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div id="social-main" tabIndex={-1} className="scroll-mt-14 focus:outline-none">
        {children}
      </div>
    </div>
  );
}
