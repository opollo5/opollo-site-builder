import Link from "next/link";
import { Sparkles } from "lucide-react";

// OnboardingReminderBanner — DESIGN-SYSTEM-OVERHAUL PR 6.
//
// Renders on the site detail page when sites.site_mode IS NULL, i.e.
// the operator hasn't chosen between "copy existing" and "new design"
// yet. Non-dismissible — the choice is the entry-point gate for both
// the design-discovery wizard and the new copy-existing extraction
// flow, so suppressing it locally would just mean the next visit shows
// a partial setup with no clear path forward.

export function OnboardingReminderBanner({ siteId }: { siteId: string }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
      role="status"
      data-testid="onboarding-reminder-banner"
    >
      <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Finish setting up this site.</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pick whether we&apos;re uploading content to an existing WordPress
          theme or building a fresh design. Generation styling and the
          rest of setup follow from this choice.
        </p>
        <Link
          href={`/admin/sites/${siteId}/onboarding`}
          className="mt-2 inline-block text-xs font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          data-testid="onboarding-reminder-banner-cta"
        >
          Set up now →
        </Link>
      </div>
    </div>
  );
}
