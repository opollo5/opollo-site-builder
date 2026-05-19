import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";

export interface TFullBleedEditorProps {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * T-FULL-BLEED-EDITOR
 *
 * Full-width editor surface for platform routes whose layout already
 * provides the outer shell (no additional PageShell wrapper needed).
 * Provides: optional back-link above header, PageHeader with
 * title/subtitle/actions, then full-bleed children.
 */
export function TFullBleedEditor({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  actions,
  children,
}: TFullBleedEditorProps) {
  return (
    <>
      {backHref && (
        <div className="mb-4 text-sm">
          <Link href={backHref} className="text-muted-foreground hover:text-foreground">
            ← {backLabel}
          </Link>
        </div>
      )}
      <PageHeader>
        <PageHeader.Title>{title}</PageHeader.Title>
        {subtitle && <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>}
        {actions && <PageHeader.Actions>{actions}</PageHeader.Actions>}
      </PageHeader>
      {children}
    </>
  );
}
