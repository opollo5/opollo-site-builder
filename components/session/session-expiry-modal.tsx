"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Spec 14 PR A — primary session-expiry warning modal.
//
// Renders centred when minutesRemaining ≤ 120m. Operator can dismiss
// via "Remind me later" — we re-prompt 30m later (until the final
// banner takes over at T-5m).
//
// Cybersecurity messaging: explains the 48h cap so operators don't
// read the modal as a session-management bug. The 48h figure is
// hard-coded into the copy — if Steven changes the dashboard JWT TTL,
// update this string in the same PR.

const PRIMARY_THRESHOLD_MIN = 120;
const RE_PROMPT_AFTER_MIN = 30; // Snooze duration after "Remind me later"
const FINAL_BANNER_THRESHOLD_MIN = 5;

interface Props {
  minutesRemaining: number | null;
  hydrated: boolean;
  onReauthenticate: () => void;
}

export function SessionExpiryModal({
  minutesRemaining,
  hydrated,
  onReauthenticate,
}: Props) {
  // Ref-style snooze: when the operator clicks "Remind me later", record
  // the minutes-remaining value AT dismissal. We re-show only when the
  // current minutesRemaining drops below (snoozedAt - 30).
  const [snoozedAt, setSnoozedAt] = useState<number | null>(null);

  // Reset the snooze if the session was extended (re-auth). minutesRemaining
  // jumps back above PRIMARY_THRESHOLD_MIN → forget the snooze.
  useEffect(() => {
    if (minutesRemaining !== null && minutesRemaining > PRIMARY_THRESHOLD_MIN) {
      setSnoozedAt(null);
    }
  }, [minutesRemaining]);

  if (!hydrated || minutesRemaining === null) return null;
  if (minutesRemaining > PRIMARY_THRESHOLD_MIN) return null;
  // Final banner takes over at T-5m — modal yields.
  if (minutesRemaining <= FINAL_BANNER_THRESHOLD_MIN) return null;

  // Honour the snooze: hide until minutesRemaining drops by at least
  // RE_PROMPT_AFTER_MIN since dismissal.
  if (snoozedAt !== null && snoozedAt - minutesRemaining < RE_PROMPT_AFTER_MIN) {
    return null;
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) setSnoozedAt(minutesRemaining);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Your session expires in about {minutesRemaining} minute
            {minutesRemaining === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            For your security, Opollo signs you out every 48 hours regardless
            of activity. Re-authenticate now to start a fresh 48-hour session,
            or save your work and we&apos;ll prompt you closer to the deadline.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setSnoozedAt(minutesRemaining)}
          >
            Remind me later
          </Button>
          <Button onClick={onReauthenticate}>Re-authenticate now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
