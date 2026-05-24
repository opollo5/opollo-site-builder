"use client";

import { Button } from "@/components/ui/button";

import type { SessionGraceStatus } from "@/lib/hooks/use-session-grace";

// Spec 14 PR A + PR B — final session-expiry banner with grace overlay.
//
// Two render states once the threshold is crossed:
//
//   1. status === 'active' && minutesRemaining ≤ 5m
//      → "Your session expires in N minutes — save your work and
//         re-authenticate." (red, undismissable, single CTA)
//
//   2. status === 'grace'
//      → "Saving your work — signing out in N min regardless of activity."
//         The wording deliberately tells the operator the timer is fixed.
//         Activity during grace does NOT extend it (per spec).
//
// status === 'logout-now' is handled by the watcher's hard-logout effect,
// not by this banner — the user is being redirected.

const FINAL_BANNER_THRESHOLD_MIN = 5;

interface Props {
  minutesRemaining: number | null;
  hydrated: boolean;
  graceMinutesRemaining: number | null;
  status: SessionGraceStatus;
  onReauthenticate: () => void;
}

export function SessionExpiryBanner({
  minutesRemaining,
  hydrated,
  graceMinutesRemaining,
  status,
  onReauthenticate,
}: Props) {
  if (!hydrated) return null;

  // Grace render — takes priority over the pre-expiry banner.
  if (status === "grace" && graceMinutesRemaining !== null) {
    return (
      <div
        role="alert"
        className="sticky top-0 z-50 flex w-full items-center justify-center gap-3 border-b border-[--color-warning-border] bg-[--color-warning-bg] px-4 py-2 text-sm text-[--color-warning-fg] shadow-sm dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
        data-testid="session-grace-banner"
      >
        <span className="font-medium">
          Saving your work — signing out in {graceMinutesRemaining} min
          {graceMinutesRemaining === 1 ? "" : "s"} regardless of activity.
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={onReauthenticate}
          className="border-amber-400 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100"
        >
          Re-authenticate
        </Button>
      </div>
    );
  }

  if (status !== "active") return null;
  if (minutesRemaining === null) return null;
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
