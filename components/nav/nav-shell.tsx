import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { NavShellClient } from "./nav-shell-client";
import { SECTION_NAV_COLLAPSED_COOKIE } from "./section-nav";
import type { NavUserContext } from "./nav-config";

// ---------------------------------------------------------------------------
// NavShell — server component. Reads collapse-state cookie so SSR +
// first paint match (no hydration flash). Delegates all interactive
// behaviour to NavShellClient.
// ---------------------------------------------------------------------------

export type { NavUserContext };

interface NavShellProps {
  children: ReactNode;
  navContext: NavUserContext;
  skipToId?: string;
  contentMaxWidth?: string;
  contentPadding?: string;
}

export async function NavShell({
  children,
  navContext,
  skipToId = "main",
  contentMaxWidth = "7xl",
  contentPadding = "px-4 py-6 sm:px-8 sm:py-8",
}: NavShellProps) {
  const initialSectionNavCollapsed =
    cookies().get(SECTION_NAV_COLLAPSED_COOKIE)?.value === "1";

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
        skipToId={skipToId}
        contentMaxWidth={contentMaxWidth}
        contentPadding={contentPadding}
      >
        {children}
      </NavShellClient>
    </>
  );
}
