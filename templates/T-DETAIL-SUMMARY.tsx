import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import { Callout } from "@/components/ui/callout";
import type { CalloutProps } from "@/components/ui/callout";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TDetailSummarySection {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  content: React.ReactNode;
}

export interface TDetailSummaryProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  /** Optional stacked callout banners above the sections. */
  callout?: CalloutProps;
  /** Optional inline alert between the callout and sections. */
  inlineAlert?: React.ReactNode;
  sections: TDetailSummarySection[];
  /** Optional sidebar — rendered alongside sections on wide mode. */
  sidebar?: React.ReactNode;
  width?: "standard" | "wide";
}

/**
 * T-DETAIL-SUMMARY — read-mostly entity detail template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [Callout] ▸ [inlineAlert] ▸
 *              Section×N (SectionHeader + content) ▸ [Sidebar — wide only]
 *
 * Wave 2 routes: /admin/sites/[id], /admin/sites/[id]/appearance,
 * /admin/companies/[id], /admin/companies/[id]/social-profiles/[id]/connections,
 * /admin/batches/[siteId]/[batchId], /admin/images/[id],
 * /admin/sites/[id]/design-system, /admin/sites/[id]/design-system/preview,
 * /optimiser/pages/[id], /optimiser/proposals/[id], /optimiser/imports/[brief_id]
 */
export function TDetailSummary({
  title,
  breadcrumb,
  subtitle,
  actions,
  meta,
  callout,
  inlineAlert,
  sections,
  sidebar,
  width = "standard",
}: TDetailSummaryProps) {
  const content = (
    <>
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

      {inlineAlert && <div className="mb-4">{inlineAlert}</div>}

      <div className={sidebar ? "flex gap-6" : undefined}>
        <div className={sidebar ? "min-w-0 flex-1 space-y-8" : "space-y-8"}>
          {sections.map((section, i) => (
            <section
              key={section.title ?? i}
              aria-labelledby={section.title ? `section-${section.title.replace(/\s+/g, "-").toLowerCase()}` : undefined}
            >
              {section.title && (
                <SectionHeader
                  title={section.title}
                  subtitle={section.subtitle}
                  actions={section.actions}
                  className="mb-4"
                />
              )}
              {section.content}
            </section>
          ))}
        </div>

        {sidebar && (
          <aside className="w-72 shrink-0">{sidebar}</aside>
        )}
      </div>
    </>
  );

  return (
    <PageShell className={width === "wide" ? "max-w-screen-2xl" : undefined}>
      {content}
    </PageShell>
  );
}
