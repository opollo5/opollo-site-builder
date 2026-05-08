"use client";

import type { ComposerMode } from "./scheduling-tabs";

// ---------------------------------------------------------------------------
// Spec 22 PR 5 — ComposerActions.
//
// Primary action button (label changes per mode) + "Schedule & create another"
// (wired in PR 5: submits current draft then resets composer for a new draft).
// ---------------------------------------------------------------------------

const MODE_LABEL: Record<ComposerMode, string> = {
  post_now: "Post",
  schedule: "Schedule",
  draft: "Save as draft",
};

interface ComposerActionsProps {
  mode: ComposerMode;
  submitting: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onSubmitAndCreateAnother?: () => void;
}

export function ComposerActions({
  mode,
  submitting,
  disabled,
  onSubmit,
  onSubmitAndCreateAnother,
}: ComposerActionsProps) {
  return (
    <div className="flex items-center gap-3">
      {/* "Schedule & create another" — only in schedule mode */}
      {mode === "schedule" && onSubmitAndCreateAnother && (
        <button
          type="button"
          onClick={onSubmitAndCreateAnother}
          disabled={disabled || submitting}
          className="rounded-md border border-white/10 px-4 py-2 text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-40"
        >
          Schedule &amp; create another
        </button>
      )}

      {/* Primary action */}
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || submitting}
        className="min-w-[100px] rounded-md bg-pk px-4 py-2 text-sm font-medium text-white hover:bg-pk/80 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : MODE_LABEL[mode]}
      </button>
    </div>
  );
}
