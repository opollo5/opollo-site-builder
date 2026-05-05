"use client";

import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const AUTO_CLOSE_DELAY_MS = 2000;
const FALLBACK_DELAY_MS = 100;

export function ApproveAutoClose({ tokenWasJustApproved }: { tokenWasJustApproved: boolean }) {
  const [closeBlocked, setCloseBlocked] = useState(false);

  useEffect(() => {
    const closeTimer = setTimeout(() => {
      try {
        window.close();
      } catch {
        // Some browsers throw, treat as a no-op so we render the fallback.
      }
      const fallbackTimer = setTimeout(() => {
        if (!window.closed) setCloseBlocked(true);
      }, FALLBACK_DELAY_MS);
      return () => clearTimeout(fallbackTimer);
    }, AUTO_CLOSE_DELAY_MS);
    return () => clearTimeout(closeTimer);
  }, []);

  function handleManualClose() {
    try {
      window.close();
    } catch {
      // Manual close also can fail; nothing more we can do.
    }
  }

  return (
    <Alert>
      <strong>Sign-in approved.</strong>{" "}
      {closeBlocked ? (
        <span>You can close this tab.</span>
      ) : (
        <span>
          {tokenWasJustApproved
            ? "Closing this tab in a moment — your original tab will sign you in automatically."
            : "Closing this tab in a moment."}
        </span>
      )}
      {closeBlocked && (
        <div className="mt-3">
          <Button
            type="button"
            onClick={handleManualClose}
            data-testid="approve-close-tab"
            variant="outline"
          >
            Close tab
          </Button>
        </div>
      )}
    </Alert>
  );
}
