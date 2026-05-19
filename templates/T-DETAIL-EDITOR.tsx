import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TDetailEditorProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional inline alert between the header and main content. */
  inlineAlert?: React.ReactNode;
  children: React.ReactNode;
  width?: "standard" | "wide";
}

/**
 * T-DETAIL-EDITOR — editor/preview detail page template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [inlineAlert] ▸ children
 *
 * Wave 3 routes: /admin/sites/[id]/posts/[post_id],
 * /admin/sites/[id]/pages/[pageId]
 */
export function TDetailEditor({
  title,
  breadcrumb,
  subtitle,
  meta,
  actions,
  inlineAlert,
  children,
  width,
}: TDetailEditorProps) {
  return (
    <PageShell className={width === "wide" ? "max-w-screen-2xl" : undefined}>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {subtitle && <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>}
        {meta && <PageHeader.Meta>{meta}</PageHeader.Meta>}
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {inlineAlert && <div className="mb-4">{inlineAlert}</div>}

      {children}
    </PageShell>
  );
}
