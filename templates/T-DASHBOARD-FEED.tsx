import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TDashboardFeedProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  /** Right-aligned actions in PageHeader. */
  actions?: React.ReactNode;
  /**
   * Optional inline alert (e.g. degraded data warning).
   * Pass an <Alert ...> element; rendered between header and feed.
   */
  inlineAlert?: React.ReactNode;
  /**
   * The feed content — a delegated client component that owns its
   * own internal layout (CalendarShell, TimelineFeed, log table, etc.).
   */
  feed: React.ReactNode;
  /**
   * Width mode.
   *  - 'standard' (default): PageShell's normal max-width cap.
   *  - 'full-bleed': stretches to the full viewport; PageShell is omitted
   *    and the page renders inside a bare <main> with h-full.
   */
  width?: "standard" | "full-bleed";
}

/**
 * T-DASHBOARD-FEED — feed-style dashboard template.
 *
 * Composition: PageShell (or full-bleed) ▸ PageHeader ▸ [Alert] ▸ feed
 *
 * Wave 1 routes: /company/social/calendar (full-bleed), /company/social/timeline,
 * /admin/maintenance
 */
export function TDashboardFeed({
  title,
  breadcrumb,
  actions,
  inlineAlert,
  feed,
  width = "standard",
}: TDashboardFeedProps) {
  const header = (
    <PageHeader>
      {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
      <PageHeader.Title>{title}</PageHeader.Title>
      {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
    </PageHeader>
  );

  if (width === "full-bleed") {
    return (
      <main className="flex h-full flex-col overflow-hidden">
        <div className="px-6 pt-6">{header}</div>
        {inlineAlert && <div className="px-6 pb-2">{inlineAlert}</div>}
        <div className="min-h-0 flex-1">{feed}</div>
      </main>
    );
  }

  return (
    <PageShell>
      {header}
      {inlineAlert && <div className="mb-4">{inlineAlert}</div>}
      {feed}
    </PageShell>
  );
}
