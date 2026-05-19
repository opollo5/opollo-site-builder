import type * as React from "react";

import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbSegment } from "./T-LIST-STANDARD";

export interface TFormSection {
  title?: string;
  description?: string;
  content: React.ReactNode;
}

export interface TFormProps {
  title: string;
  breadcrumb?: BreadcrumbSegment[];
  subtitle?: string;
  actions?: React.ReactNode;
  /** Optional top-of-form error alert. */
  inlineAlert?: React.ReactNode;
  /** Form sections with optional title/description headers. */
  formSections: TFormSection[];
  /**
   * Width mode.
   * - 'form' (default): max-w-2xl — optimal for form line length.
   * - 'standard': max-w-7xl
   * - 'wide': max-w-screen-2xl
   */
  width?: "narrow" | "form" | "standard" | "wide";
}

const WIDTH_CLASS: Record<NonNullable<TFormProps["width"]>, string | undefined> = {
  narrow: "max-w-xl",
  form: "max-w-2xl",
  standard: undefined,
  wide: "max-w-screen-2xl",
};

/**
 * T-FORM — create/edit form shell template.
 *
 * Composition: PageShell (form-width) ▸ PageHeader ▸ [inlineAlert] ▸
 *              FormSection×N (optional title + description + content)
 *
 * Form submit/cancel actions stay in the inner form component —
 * this shell provides page chrome only.
 *
 * Wave 2 routes: /admin/sites/new, /admin/sites/[id]/edit,
 * /admin/sites/[id]/posts/new, /admin/companies/new,
 * /admin/posts/[siteId]/new, /admin/email-test
 */
export function TForm({
  title,
  breadcrumb,
  subtitle,
  actions,
  inlineAlert,
  formSections,
  width = "form",
}: TFormProps) {
  return (
    <PageShell className={WIDTH_CLASS[width]}>
      <PageHeader>
        {breadcrumb && <PageHeader.Breadcrumb segments={breadcrumb} />}
        <PageHeader.Title>{title}</PageHeader.Title>
        {subtitle && <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>}
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>

      {inlineAlert && <div className="mb-4">{inlineAlert}</div>}

      <div className="space-y-8">
        {formSections.map((section, i) => (
          <div key={section.title ?? i}>
            {(section.title || section.description) && (
              <div className="mb-4">
                {section.title && (
                  <h2 className="text-base font-semibold">{section.title}</h2>
                )}
                {section.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {section.description}
                  </p>
                )}
              </div>
            )}
            {section.content}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
