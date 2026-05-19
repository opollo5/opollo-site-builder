import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionHeader } from "@/components/ui/section-header";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TSettingsFlatSection {
  title: string;
  description?: string;
  content: React.ReactNode;
}

export interface TSettingsFlatProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: string;
  actions?: React.ReactNode;
  /** Optional inline alerts stacked at the top. */
  inlineAlerts?: React.ReactNode[];
  sections: TSettingsFlatSection[];
  /**
   * Width mode.
   * - 'form' (default): max-w-2xl — keeps settings pages readable.
   * - 'standard': max-w-7xl
   * - 'wide': max-w-screen-2xl
   */
  width?: "narrow" | "form" | "standard" | "wide";
}

const WIDTH_CLASS: Record<NonNullable<TSettingsFlatProps["width"]>, string | undefined> = {
  narrow: "max-w-xl",
  form: "max-w-2xl",
  standard: undefined,
  wide: "max-w-screen-2xl",
};

/**
 * T-SETTINGS-FLAT — flat settings page template.
 *
 * Composition: PageShell ▸ PageHeader ▸ [Alert×N] ▸
 *              Section×N (SectionHeader + content)
 *
 * Wave 2 routes: /admin/sites/[id]/settings, /admin/settings/design-system,
 * /account/security, /account/devices, /company/settings/brand,
 * /optimiser/clients/[id]/settings, /company/social/sharing
 */
export function TSettingsFlat({
  title,
  breadcrumb,
  subtitle,
  actions,
  inlineAlerts,
  sections,
  width = "form",
}: TSettingsFlatProps) {
  return (
    <PageShell className={WIDTH_CLASS[width]}>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {subtitle && <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>}
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {inlineAlerts && inlineAlerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {inlineAlerts.map((alert, i) => (
            <div key={i}>{alert}</div>
          ))}
        </div>
      )}

      <div className="space-y-8">
        {sections.map((section) => (
          <section
            key={section.title}
            aria-labelledby={`settings-${section.title.replace(/\s+/g, "-").toLowerCase()}`}
          >
            <SectionHeader
              title={section.title}
              subtitle={section.description}
              className="mb-4"
            />
            {section.content}
          </section>
        ))}
      </div>
    </PageShell>
  );
}
