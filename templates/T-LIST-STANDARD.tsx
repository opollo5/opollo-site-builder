import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Callout } from "@/components/ui/callout";
import type { CalloutProps } from "@/components/ui/callout";

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

export interface TListStandardProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: string;
  /** Right-aligned action buttons in the PageHeader. */
  actions?: React.ReactNode;
  /** Inline meta row (e.g. timezone, record count). */
  meta?: React.ReactNode;
  /** Optional banner-shape callout above the filter bar. */
  callout?: CalloutProps;
  /** Filter/search controls row. */
  filterBar?: React.ReactNode;
  /** List content: DataTable, stacked-list, or EmptyState. */
  children: React.ReactNode;
  /** Optional pagination bar below the list. */
  pagination?: React.ReactNode;
  /**
   * Width mode.
   * - 'standard' (default): max-w-7xl
   * - 'wide': max-w-screen-2xl (used by T-LIST-WIDE)
   */
  width?: "standard" | "wide";
}

/**
 * T-LIST-STANDARD — standard-width index list template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [Callout] ▸ [filterBar] ▸ children ▸ [Pagination]
 *
 * Wave 1 routes: /admin/sites, /admin/sites/[id]/content, /admin/sites/[id]/posts,
 * /admin/sites/[id]/pages, /company/social/posts, /company/social/connections
 */
export function TListStandard({
  title,
  breadcrumb,
  subtitle,
  actions,
  meta,
  callout,
  filterBar,
  children,
  pagination,
  width = "standard",
}: TListStandardProps) {
  return (
    <PageShell className={width === "wide" ? "max-w-screen-2xl" : undefined}>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {subtitle && <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>}
        {meta && <PageHeader.Meta>{meta}</PageHeader.Meta>}
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {callout && (
        <div className="mb-4">
          <Callout {...callout} />
        </div>
      )}

      {filterBar && <div className="mb-4">{filterBar}</div>}

      {children}

      {pagination && <div className="mt-4">{pagination}</div>}
    </PageShell>
  );
}
