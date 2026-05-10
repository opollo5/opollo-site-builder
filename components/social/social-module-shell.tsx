import * as React from "react";
import Link from "next/link";

import { PillTabs, type PillTab } from "@/components/ui/pill-tabs";

// ---------------------------------------------------------------------------
// SocialModuleShell — shared chrome for the social module.
//
// Owns the breadcrumb row, the toolbar (workspace selector, period navigator
// slot, tab group, toolbar actions slot, primary CTA), and renders the
// children content area beneath. The page component is responsible for its
// own padding/margin around the shell + the content within `children`.
// ---------------------------------------------------------------------------

type SocialView = "calendar" | "posts" | "timeline";

export interface SocialModuleShellProps {
  activeView: SocialView;
  periodNavigator?: React.ReactNode;
  toolbarActions?: React.ReactNode;
  children: React.ReactNode;
}

const TABS: readonly PillTab[] = [
  { value: "calendar", label: "Calendar", href: "/company/social/calendar" },
  { value: "posts", label: "Posts", href: "/company/social/posts" },
  { value: "timeline", label: "Timeline", href: "/company/social/timeline" },
];

const VIEW_LABEL: Record<SocialView, string> = {
  calendar: "Calendar",
  posts: "Posts",
  timeline: "Timeline",
};

export function SocialModuleShell({
  activeView,
  periodNavigator,
  toolbarActions,
  children,
}: SocialModuleShellProps) {
  return (
    <div data-testid="social-module-shell">
      {/* Breadcrumb row */}
      <nav aria-label="Breadcrumb" className="mb-3 text-sm">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link
              href="/company/social"
              className="text-tx-muted hover:text-tx-primary"
            >
              Social
            </Link>
          </li>
          <li aria-hidden="true" className="text-tx-muted">
            /
          </li>
          <li className="text-tx-primary" aria-current="page">
            {VIEW_LABEL[activeView]}
          </li>
        </ol>
      </nav>

      {/* Toolbar row */}
      <div
        data-testid="social-module-toolbar"
        className="mb-4 flex flex-wrap items-center gap-3"
      >
        {/* Period navigator slot (calendar passes ‹ Month YYYY ›) */}
        {periodNavigator ? <div>{periodNavigator}</div> : null}

        {/* Tab group */}
        <PillTabs tabs={TABS} activeValue={activeView} />

        {/* Toolbar actions slot (calendar passes ProfilesFilter) */}
        {toolbarActions ? <div>{toolbarActions}</div> : null}
      </div>

      {children}
    </div>
  );
}
