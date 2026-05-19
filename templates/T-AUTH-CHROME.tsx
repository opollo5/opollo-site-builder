import { H1, Lead } from "@/components/ui/typography";

export interface TAuthChromeProps {
  title: string;
  /** Rendered beneath the title as a Lead paragraph. Accepts ReactNode for inline emphasis. */
  subtitle?: React.ReactNode;
  /** Icon/badge element rendered above the title (e.g. auth/expired lock icon). */
  titleIcon?: React.ReactNode;
  /** Back-link or supplementary action rendered below the card. */
  footer?: React.ReactNode;
  /**
   * "md" (default) — max-w-md (448px). Standard auth forms.
   * "lg" — max-w-lg (512px). Wider for informational pages (e.g. session-expired).
   */
  width?: "md" | "lg";
  children: React.ReactNode;
}

/**
 * T-AUTH-CHROME
 *
 * Full-screen centered layout for unauthenticated surfaces.
 * Provides: min-h-screen bg-canvas centering, title/subtitle header,
 * optional icon above title, optional footer below card area.
 * Children are rendered as-is — each page owns its own card wrapper.
 */
export function TAuthChrome({
  title,
  subtitle,
  titleIcon,
  footer,
  width = "md",
  children,
}: TAuthChromeProps) {
  const maxWidth = width === "lg" ? "max-w-lg" : "max-w-md";

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className={`w-full ${maxWidth} space-y-6`}>
        <div className="text-center">
          {titleIcon && (
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center">
              {titleIcon}
            </div>
          )}
          <H1>{title}</H1>
          {subtitle && <Lead className="mt-1">{subtitle}</Lead>}
        </div>
        {children}
        {footer && (
          <p className="text-center text-sm text-muted-foreground">{footer}</p>
        )}
      </div>
    </main>
  );
}
