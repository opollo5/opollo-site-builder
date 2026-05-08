import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { NavShellClient } from "./nav-shell-client";
import { SECTION_NAV_COLLAPSED_COOKIE } from "./section-nav";
import { PRIMARY_NAV_COLLAPSED_COOKIE } from "./nav-shell-cookies";
import type { NavUserContext } from "./nav-config";

// ---------------------------------------------------------------------------
// NavShell — server component. Reads collapse-state cookies for both the
// primary rail and the section panel so SSR + first paint match (no
// hydration flash). Delegates all interactive behaviour to NavShellClient.
// ---------------------------------------------------------------------------

export type { NavUserContext };

interface NavShellProps {
  children: ReactNode;
  navContext: NavUserContext;
  skipToId?: string;
}

export async function NavShell({
  children,
  navContext,
  skipToId = "main",
}: NavShellProps) {
  const cookieJar = cookies();
  const initialSectionNavCollapsed =
    cookieJar.get(SECTION_NAV_COLLAPSED_COOKIE)?.value === "1";
  const initialPrimaryNavCollapsed =
    cookieJar.get(PRIMARY_NAV_COLLAPSED_COOKIE)?.value === "1";

  return (
    <>
      <a
        href={`#${skipToId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Skip to main content
      </a>
      <NavShellClient
        navContext={navContext}
        initialSectionNavCollapsed={initialSectionNavCollapsed}
        initialPrimaryNavCollapsed={initialPrimaryNavCollapsed}
        skipToId={skipToId}
      >
        {children}
      </NavShellClient>
    </>
  );
}
