import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TGridProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: string;
  actions?: React.ReactNode;
  /** Optional inline alert between the header and grid. */
  inlineAlert?: React.ReactNode;
  children: React.ReactNode;
  width?: "standard" | "wide";
}

/**
 * T-GRID — card/asset grid index template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [inlineAlert] ▸ children
 *
 * Wave 3 routes: /company/social/media,
 * /admin/sites/[id]/design-system/components (layout-driven, deferred)
 */
export function TGrid({
  title,
  breadcrumb,
  subtitle,
  actions,
  inlineAlert,
  children,
  width,
}: TGridProps) {
  return (
    <PageShell className={width === "wide" ? "max-w-screen-2xl" : undefined}>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {subtitle && <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>}
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {inlineAlert && <div className="mb-4">{inlineAlert}</div>}

      {children}
    </PageShell>
  );
}
