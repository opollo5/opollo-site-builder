import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TReviewLinkProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional inline alert below the header. */
  inlineAlert?: React.ReactNode;
  children: React.ReactNode;
  width?: "standard" | "wide";
}

/**
 * T-REVIEW-LINK — review/approval page template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [inlineAlert] ▸ children
 *
 * Wave 3 routes: /admin/sites/[id]/briefs/[brief_id]/review,
 * /admin/sites/[id]/blueprints/review
 */
export function TReviewLink({
  title,
  breadcrumb,
  subtitle,
  actions,
  inlineAlert,
  children,
  width,
}: TReviewLinkProps) {
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
