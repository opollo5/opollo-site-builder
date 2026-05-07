"use client";

import { Button } from "@/components/ui/button";

// Spec 14 PR A — final session-expiry banner.
//
// Renders top-centre, undismissable, when minutesRemaining ≤ 5m. No close
// button. Single CTA. Visual urgency: red border, sticky top.
//
// PR B will add the activity-grace overlay (extends past T-0 by up to
// 15 minutes if the operator is mid-task). PR C plumbs the re-auth flow.

const FINAL_BANNER_THRESHOLD_MIN = 5;

interface Props {
  minutesRemaining: number | null;
  hydrated: boolean;
  onReauthenticate: () => void;
}

export function SessionExpiryBanner({
  minutesRemaining,
  hydrated,
  onReauthenticate,
}: Props) {
  if (!hydrated || minutesRemaining === null) return null;
  if (minutesRemaining > FINAL_BANNER_THRESHOLD_MIN) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 flex w-full items-center justify-center gap-3 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 shadow-sm dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
      data-testid="session-expiry-banner"
    >
      <span className="font-medium">
        Your session expires in {minutesRemaining} minute
        {minutesRemaining === 1 ? "" : "s"}
        {" — "}
        save your work and re-authenticate.
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={onReauthenticate}
        className="border-red-400 text-red-900 hover:bg-red-100 dark:border-red-700 dark:text-red-100"
      >
        Re-authenticate
      </Button>
    </div>
  );
}
