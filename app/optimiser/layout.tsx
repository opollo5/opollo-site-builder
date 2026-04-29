import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";

// Optimiser module shell.
//
// Same auth posture as /admin: admin + operator may write, viewer may
// read. Reuses checkAdminAccess so the role gate stays defined in one
// place.

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
