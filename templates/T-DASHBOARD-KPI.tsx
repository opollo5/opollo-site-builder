import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Callout } from "@/components/ui/callout";
import { SectionHeader } from "@/components/ui/section-header";
import type { CalloutProps } from "@/components/ui/callout";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface KpiItem {
  label: string;
  value: string | number;
  /** e.g. "+12% vs last week" */
  delta?: string;
  /** Linearicons icon name string */
  icon?: string;
}

export interface TDashboardKpiProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  actions?: React.ReactNode;
  callout?: CalloutProps;
  /** KPI metric tiles rendered in a responsive grid. */
  kpis: KpiItem[];
  /** Optional data sections below the KPI grid (each with a SectionHeader + content). */
  dataSections?: Array<{
    title: string;
    actions?: React.ReactNode;
    content: React.ReactNode;
  }>;
  width?: "standard" | "wide";
}

/**
 * T-DASHBOARD-KPI — KPI-tile + supporting data-table dashboard template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [Callout] ▸ KpiCardGrid ▸ [SectionHeader + content]×N
 *
 * Wave 1 routes: /company, /company/social/analytics,
 * /admin/companies/[id]/social-profiles/[profileId]/analytics,
 * /admin/system/jobs, /optimiser/diagnostics
 */
export function TDashboardKpi({
  title,
  breadcrumb,
  actions,
  callout,
  kpis,
  dataSections,
  width = "standard",
}: TDashboardKpiProps) {
  return (
    <PageShell className={width === "wide" ? "max-w-screen-2xl" : undefined}>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {callout && (
        <div className="mb-6">
          <Callout {...callout} />
        </div>
      )}

      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-lg border bg-card p-4 shadow-sm"
            >
              <p className="text-sm text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {kpi.value}
              </p>
              {kpi.delta && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {kpi.delta}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {dataSections?.map((section, i) => (
        <section key={section.title} className={i === 0 ? "mt-8" : "mt-6"}>
          <SectionHeader title={section.title} actions={section.actions} />
          <div className="mt-3">{section.content}</div>
        </section>
      ))}
    </PageShell>
  );
}
