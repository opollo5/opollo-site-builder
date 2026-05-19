import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { Callout } from "@/components/ui/callout";
import type { CalloutProps } from "@/components/ui/callout";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TWizardStepProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: string;
  actions?: React.ReactNode;
  /** Optional banner callout above the wizard content. */
  callout?: CalloutProps;
  children: React.ReactNode;
  width?: "standard" | "wide";
}

/**
 * T-WIZARD-STEP — multi-step wizard page template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [Callout] ▸ children
 *
 * Wave 3 routes: /admin/sites/[id]/setup, /admin/sites/[id]/setup/extract,
 * /admin/sites/[id]/onboarding, /optimiser/onboarding,
 * /optimiser/onboarding/[id]
 */
export function TWizardStep({
  title,
  breadcrumb,
  subtitle,
  actions,
  callout,
  children,
  width,
}: TWizardStepProps) {
  return (
    <PageShell className={width === "wide" ? "max-w-screen-2xl" : undefined}>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {subtitle && <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>}
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {callout && (
        <div className="mb-4">
          <Callout {...callout} />
        </div>
      )}

      {children}
    </PageShell>
  );
}
