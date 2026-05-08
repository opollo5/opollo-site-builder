// Spec 22 PR 1 — composer state machine per ADR-0001.
//
// Named state machine via useReducer. No scattered booleans.
// PR 1 activates: idle → loading → editing → saving → saved.
// PR 2+ activates: publishing, published, failed, recovering.

import type { DraftData } from "@/lib/platform/social/drafts";

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type Draft = {
  id: string;
  draft_version: number;
  draft_data: DraftData;
};

export type ComposerError = {
  message: string;
  code: string;
  correlationId?: string;
};

export type ComposerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "editing"; draft: Draft; dirty: boolean }
  | { status: "saving"; draft: Draft }
  | { status: "saved"; draft: Draft; savedAt: Date }
  | { status: "publishing"; draft: Draft }
  | { status: "published"; postId: string }
  | { status: "failed"; draft: Draft; error: ComposerError; retryable: boolean }
  | { status: "recovering"; staleDraft: Draft; freshDraft: Draft };

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export type ComposerAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; draft: Draft }
  | { type: "UPDATE_DRAFT"; patch: Partial<DraftData> }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS"; draft: Draft; savedAt: Date }
  | { type: "SAVE_FAIL"; error: ComposerError; retryable: boolean }
  | { type: "PUBLISH_START" }
  | { type: "PUBLISH_SUCCESS"; postId: string }
  | { type: "PUBLISH_FAIL"; error: ComposerError; retryable: boolean }
  | { type: "CONFLICT_DETECTED"; staleDraft: Draft; freshDraft: Draft }
  | { type: "CONFLICT_RESOLVED_RELOAD" }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const INITIAL_STATE: ComposerState = { status: "idle" };

export function composerReducer(
  state: ComposerState,
  action: ComposerAction,
): ComposerState {
  switch (action.type) {
    case "LOAD_START":
      return { status: "loading" };

    case "LOAD_SUCCESS":
      return { status: "editing", draft: action.draft, dirty: false };

    case "UPDATE_DRAFT": {
      if (state.status !== "editing" && state.status !== "saved") return state;
      const draft: Draft =
        state.status === "saved"
          ? state.draft
          : state.draft;
      return {
        status: "editing",
        draft: {
          ...draft,
          draft_data: { ...draft.draft_data, ...action.patch },
        },
        dirty: true,
      };
    }

    case "SAVE_START": {
      if (state.status !== "editing" && state.status !== "saved") return state;
      return { status: "saving", draft: state.draft };
    }

    case "SAVE_SUCCESS":
      return { status: "saved", draft: action.draft, savedAt: action.savedAt };

    case "SAVE_FAIL": {
      if (state.status !== "saving") return state;
      return {
        status: "failed",
        draft: state.draft,
        error: action.error,
        retryable: action.retryable,
      };
    }

    case "PUBLISH_START": {
      if (state.status !== "editing" && state.status !== "saved") return state;
      return { status: "publishing", draft: state.draft };
    }

    case "PUBLISH_SUCCESS":
      return { status: "published", postId: action.postId };

    case "PUBLISH_FAIL": {
      if (state.status !== "publishing") return state;
      return {
        status: "failed",
        draft: state.draft,
        error: action.error,
        retryable: action.retryable,
      };
    }

    case "CONFLICT_DETECTED":
      return {
        status: "recovering",
        staleDraft: action.staleDraft,
        freshDraft: action.freshDraft,
      };

    case "CONFLICT_RESOLVED_RELOAD": {
      if (state.status !== "recovering") return state;
      return { status: "editing", draft: state.freshDraft, dirty: false };
    }

    case "RESET":
      return { status: "idle" };

    default:
      return state;
  }
}
