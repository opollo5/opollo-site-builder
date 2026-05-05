import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { SocialNavClient } from "@/components/SocialNavClient";
import { getCurrentPlatformSession } from "@/lib/platform/auth";

// ---------------------------------------------------------------------------
// /company/social/* — secondary sub-nav strip.
//
// The outer min-h-screen shell, skip link, brand header, and
// NotificationBell are provided by app/company/layout.tsx.
// This layout adds only the social tab strip beneath that outer header.
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
    <>
      <div className="border-b border-border bg-background/95 backdrop-blur sticky top-[49px] z-10">
        <nav
          className="mx-auto flex max-w-5xl items-center overflow-x-auto px-6 py-2"
          aria-label="Social navigation"
        >
          <SocialNavClient />
        </nav>
      </div>
      <div id="social-main" tabIndex={-1} className="scroll-mt-[97px] focus:outline-none">
        {children}
      </div>
    </>
  );
}
