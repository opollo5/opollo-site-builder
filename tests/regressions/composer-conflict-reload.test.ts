// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { composerReducer, INITIAL_STATE } from "@/components/composer/use-composer-reducer";
import type { ComposerState, Draft } from "@/components/composer/use-composer-reducer";

// ---------------------------------------------------------------------------
// REGRESSION — CONFLICT_RESOLVED_RELOAD must replace staleDraft with freshDraft
// and mark the state as editing + clean.
//
// FIX 14: Verified that the existing reducer handles this correctly.
// ---------------------------------------------------------------------------

const STALE_DRAFT: Draft = {
  id: "draft-aaa",
  draft_version: 3,
  draft_data: {
    master_text: "stale text",
    link_url: null,
    media_refs: [],
    target_connection_ids: [],
    schedule: null,
    approval_required: false,
    ai_metadata: null,
  },
};

const FRESH_DRAFT: Draft = {
  id: "draft-aaa",
  draft_version: 5,
  draft_data: {
    master_text: "fresh text from server",
    link_url: null,
    media_refs: [],
    target_connection_ids: [],
    schedule: null,
    approval_required: false,
    ai_metadata: null,
  },
};

describe("R-CONFLICT-RELOAD: CONFLICT_RESOLVED_RELOAD replaces draft with fresh copy", () => {
  const recoveringState: ComposerState = {
    status: "recovering",
    staleDraft: STALE_DRAFT,
    freshDraft: FRESH_DRAFT,
  };

  it("transitions from recovering to editing with freshDraft content", () => {
    const next = composerReducer(recoveringState, { type: "CONFLICT_RESOLVED_RELOAD" });
    expect(next.status).toBe("editing");
    if (next.status === "editing") {
      expect(next.draft.draft_data.master_text).toBe("fresh text from server");
      expect(next.draft.draft_version).toBe(5);
    }
  });

  it("marks the reloaded draft as not dirty", () => {
    const next = composerReducer(recoveringState, { type: "CONFLICT_RESOLVED_RELOAD" });
    if (next.status === "editing") {
      expect(next.dirty).toBe(false);
    }
  });

  it("is a no-op when not in recovering state", () => {
    const editingState: ComposerState = { status: "editing", draft: STALE_DRAFT, dirty: true };
    const next = composerReducer(editingState, { type: "CONFLICT_RESOLVED_RELOAD" });
    expect(next).toBe(editingState);
  });

  it("CONFLICT_DETECTED transitions to recovering with both drafts accessible", () => {
    const editingState: ComposerState = { status: "editing", draft: STALE_DRAFT, dirty: true };
    const next = composerReducer(editingState, {
      type: "CONFLICT_DETECTED",
      staleDraft: STALE_DRAFT,
      freshDraft: FRESH_DRAFT,
    });
    expect(next.status).toBe("recovering");
    if (next.status === "recovering") {
      expect(next.staleDraft.draft_version).toBe(3);
      expect(next.freshDraft.draft_version).toBe(5);
    }
  });
});
