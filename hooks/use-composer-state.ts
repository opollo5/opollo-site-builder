"use client";

import * as React from "react";
import type { Draft } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// useComposerState — manages open/closed, draft, dirty flag.
//
// Dirty = user has modified the draft content since it was last saved or opened.
// When setComposerState({ open: false }) is called with dirty === true, the
// overlay does NOT close immediately — it sets pendingClose=true, allowing the
// ComposerOverlay to show the UnsavedChangesDialog.
// ---------------------------------------------------------------------------

export interface ComposerState {
  open: boolean;
  draft: Draft;
  dirty: boolean;
  /** True while the overlay is trying to close but awaiting the discard/save decision. */
  pendingClose: boolean;
  prefilledDate?: Date;
}

export interface SetComposerStateArg {
  open?: boolean;
  draft?: Partial<Draft>;
  prefilledDate?: Date;
}

const DEFAULT_DRAFT: Draft = {
  content: "",
  media_urls: [],
  target_profile_ids: [],
  platform_variants: {},
  approval_required: false,
};

export function useComposerState() {
  const [state, setState] = React.useState<ComposerState>({
    open: false,
    draft: DEFAULT_DRAFT,
    dirty: false,
    pendingClose: false,
  });

  const setComposerState = React.useCallback(
    (arg: SetComposerStateArg) => {
      setState((prev) => {
        const nextOpen = arg.open ?? prev.open;

        // Requesting close while dirty → flag pending close instead
        if (nextOpen === false && prev.open && prev.dirty) {
          return { ...prev, pendingClose: true };
        }

        const nextDraft = arg.draft
          ? { ...prev.draft, ...arg.draft }
          : prev.draft;

        return {
          ...prev,
          open: nextOpen,
          draft: nextDraft,
          prefilledDate: arg.prefilledDate ?? prev.prefilledDate,
          dirty: false,
          pendingClose: false,
        };
      });
    },
    [],
  );

  const updateDraft = React.useCallback((patch: Partial<Draft>) => {
    setState((prev) => ({
      ...prev,
      draft: { ...prev.draft, ...patch },
      dirty: true,
    }));
  }, []);

  const openComposer = React.useCallback(
    (opts?: { initialDraft?: Draft; prefilledDate?: Date }) => {
      setState({
        open: true,
        draft: opts?.initialDraft ?? DEFAULT_DRAFT,
        dirty: false,
        pendingClose: false,
        prefilledDate: opts?.prefilledDate,
      });
    },
    [],
  );

  const discardChanges = React.useCallback(() => {
    setState({
      open: false,
      draft: DEFAULT_DRAFT,
      dirty: false,
      pendingClose: false,
    });
  }, []);

  const cancelClose = React.useCallback(() => {
    setState((prev) => ({ ...prev, pendingClose: false }));
  }, []);

  return {
    composerState: state,
    setComposerState,
    updateDraft,
    openComposer,
    discardChanges,
    cancelClose,
  };
}
