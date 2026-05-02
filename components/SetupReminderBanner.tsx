"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

// SetupReminderBanner — DESIGN-DISCOVERY PR 12.
//
// Renders on the site detail page when both
// sites.design_direction_status and sites.tone_of_voice_status are
// 'pending'. Dismissible — dismissed state lives in localStorage
// keyed by site id (not a DB column per the spec). Returning to the
// detail page after running through the wizard means the parent
// server component drops needsSetup=false and the banner doesn't
// render at all.

const STORAGE_PREFIX = "opollo:design-discovery:banner-dismissed:";

export function SetupReminderBanner({ siteId }: { siteId: string }) {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dismissed = window.localStorage.getItem(`${STORAGE_PREFIX}${siteId}`);
      setHidden(dismissed === "1");
    } catch {
      setHidden(false);
    }
  }, [siteId]);

  if (hidden) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${siteId}`, "1");
    } catch {
      // Storage quota / private mode — the dismissal won't persist
      // across reloads but the banner closes for this session.
    }
    setHidden(true);
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-foreground/15 bg-foreground/5 p-3 text-sm"
      role="status"
      data-testid="setup-reminder-banner"
    >
      <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Set up your design direction and tone of voice to improve
          generated content quality.
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Two skippable steps. Sets the look and voice every page we
          generate is styled around.
        </p>
        <Link
          href={`/admin/sites/${siteId}/setup`}
          className="mt-2 inline-block text-sm font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          data-testid="setup-reminder-banner-cta"
        >
          Set up now →
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-md p-1 text-muted-foreground transition-smooth hover:bg-foreground/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Dismiss"
        data-testid="setup-reminder-banner-dismiss"
      >
        <X aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}
