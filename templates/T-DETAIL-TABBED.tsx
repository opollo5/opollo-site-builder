"use client";

import * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TabItem {
  key: string;
  label: string;
  content: React.ReactNode;
}

export interface TDetailTabbedProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  actions?: React.ReactNode;
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (key: string) => void;
  /** Optional alert banners between PageHeader and TabBar. */
  inlineAlerts?: React.ReactNode[];
  /**
   * Mandated by D-4 — fixes RECURRING-2 (post-publish dead-end).
   * Default contents for the social-posts variant:
   *   [View on platform, Schedule another, Back to posts]
   * "Schedule another" is the primary button.
   */
  footerActions: React.ReactNode;
}

/**
 * T-DETAIL-TABBED — tabbed detail page template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [Alert×N] ▸ TabBar ▸ TabPanel ▸ FooterActions
 *
 * Wave 1 routes: /company/social/posts/[id] (critical, RECURRING-2 fix)
 */
export function TDetailTabbed({
  title,
  breadcrumb,
  actions,
  tabs,
  activeTab,
  onTabChange,
  inlineAlerts,
  footerActions,
}: TDetailTabbedProps) {
  const active = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  return (
    <PageShell>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {inlineAlerts?.map((alert, i) => (
        <div key={i} className="mb-3">
          {alert}
        </div>
      ))}

      {/* TabBar */}
      <div
        role="tablist"
        aria-label="Page sections"
        className="mb-6 flex gap-1 border-b border-border"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={tab.key === activeTab}
            aria-controls={`tabpanel-${tab.key}`}
            type="button"
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              tab.key === activeTab
                ? "border-b-2 border-brand-primary text-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TabPanel */}
      {active && (
        <div
          role="tabpanel"
          id={`tabpanel-${active.key}`}
          aria-labelledby={active.key}
        >
          {active.content}
        </div>
      )}

      {/* FooterActions — sticky, right-aligned (D-4) */}
      <div className="sticky bottom-0 mt-8 border-t border-border bg-background px-0 py-4">
        <div className="flex justify-end gap-3">{footerActions}</div>
      </div>
    </PageShell>
  );
}
