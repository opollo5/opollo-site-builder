"use client";

import * as React from "react";
import { ComposerOverlay } from "@/components/social/composer/ComposerOverlay";
import { useComposerState } from "@/hooks/use-composer-state";

// ---------------------------------------------------------------------------
// Social Poster — placeholder dashboard page (PR C).
// Mounts the ComposerOverlay shell so it can be exercised and tested.
// Replaced by the real dashboard in PR F.
// Feature flag: FEATURE_COMPOSER_V2 must be "true".
// ---------------------------------------------------------------------------

const FEATURE_ON = process.env.NEXT_PUBLIC_FEATURE_COMPOSER_V2 === "true";

export default function SocialPosterPage() {
  const { composerState, openComposer, discardChanges, cancelClose } =
    useComposerState();

  if (!FEATURE_ON) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        FEATURE_COMPOSER_V2 is not enabled.
      </div>
    );
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-4">
      <h1 className="text-lg font-semibold">Social Poster (Composer V2)</h1>
      <p className="text-sm text-muted-foreground">
        Dashboard coming in PR F. Open the composer to preview the shell.
      </p>
      <button
        type="button"
        onClick={() => openComposer()}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Open composer
      </button>

      <ComposerOverlay
        open={composerState.open}
        onClose={() => {
          if (composerState.dirty && !composerState.pendingClose) {
            // Trigger pending-close path in the hook
            openComposer(); // no-op shape — overlay handles dirty state via pendingClose
          }
          discardChanges();
        }}
        initialDraft={composerState.draft}
        prefilledDate={composerState.prefilledDate}
        availableConnections={[]}
      />
    </main>
  );
}
