import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";

// Optimiser module shell.
//
// Same auth posture as /admin: admin + operator may write, viewer may
// read. Reuses checkAdminAccess so the role gate stays defined in one
// place.

const NAV = [
  { href: "/optimiser", label: "Pages" },
  { href: "/optimiser/proposals", label: "Proposals" },
  { href: "/optimiser/change-log", label: "Change log" },
  { href: "/optimiser/onboarding", label: "Onboarding" },
  { href: "/optimiser/diagnostics", label: "Diagnostics" },
];

export default async function OptimiserLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#optimiser-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3 text-sm">
          <span className="font-semibold tracking-tight">
            Opollo · Optimiser
          </span>
          <span className="text-muted-foreground">·</span>
          <ul className="flex items-center gap-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded-md px-2 py-1 hover:bg-muted"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <span className="ml-auto">
            <Link
              href="/admin"
              className="text-muted-foreground hover:text-foreground"
            >
              ↗ Admin
            </Link>
          </span>
        </nav>
      </header>
      <main
        id="optimiser-main"
        tabIndex={-1}
        className="mx-auto max-w-6xl p-6 scroll-mt-16 focus:outline-none"
      >
        {children}
      </main>
    </div>
  );
}
