"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useRouter } from "next/navigation";

import { NavIcon } from "@/components/ui/nav-icon";
import { useAutoSave } from "@/lib/hooks/use-auto-save";
import type { DraftData } from "@/lib/platform/social/drafts";
import {
  composerReducer,
  INITIAL_STATE,
} from "./use-composer-reducer";
import type { ComposerError, Draft } from "./use-composer-reducer";

// ---------------------------------------------------------------------------
// Spec 22 PR 1 — PostComposerModal shell.
//
// Full-screen modal overlay. Opens when ?compose=new (creates draft) or
// ?compose=<uuid> (loads existing draft). Closing removes the search param.
//
// PR 1 ships: modal chrome, state machine wiring, autosave. The editor
// content pane is a placeholder; PR 2 replaces it with real editor
// components (ProfileSelector, ComposerTextarea, ImageUploadZone, etc.).
// ---------------------------------------------------------------------------

interface PostComposerModalProps {
  companyId: string;
  userId: string;
  /** null = new draft; string = load existing draft by ID */
  initialDraftId: string | null;
  correlationId: string;
}

const AUTOSAVE_KEY_PREFIX = "composer-draft";

export function PostComposerModal({
  companyId,
  userId,
  initialDraftId,
  correlationId,
}: PostComposerModalProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(composerReducer, INITIAL_STATE);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  // Derive current draft for autosave getValue; stable ref so the callback
  // doesn't trigger hook re-subscriptions on every render.
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---------------------------------------------------------------------------
  // Initialise: create or load draft on mount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "LOAD_START" });

    async function init() {
      try {
        const url = initialDraftId
          ? `/api/platform/social/drafts/${initialDraftId}`
          : "/api/platform/social/drafts";
        const response = await fetch(url, {
          method: initialDraftId ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-correlation-id": correlationId,
          },
          body: initialDraftId
            ? undefined
            : JSON.stringify({ company_id: companyId }),
        });

        if (cancelled) return;

        const result = await response.json();
        if (!result.ok) {
          dispatch({
            type: "SAVE_FAIL",
            error: { message: result.error?.message ?? "Failed to initialise draft.", code: result.error?.code ?? "INTERNAL_ERROR", correlationId },
            retryable: result.error?.retryable ?? true,
          });
          return;
        }

        dispatch({
          type: "LOAD_SUCCESS",
          draft: {
            id: result.data.id,
            draft_version: result.data.draft_version,
            draft_data: result.data.draft_data,
          },
        });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: "SAVE_FAIL",
          error: { message: err instanceof Error ? err.message : "Network error.", code: "NETWORK_ERROR", correlationId },
          retryable: true,
        });
      }
    }

    void init();
    return () => { cancelled = true; };
    // Intentionally only run on mount — initialDraftId is stable per modal open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Autosave — wired through Spec 14 useAutoSave hook
  // ---------------------------------------------------------------------------

  const getDraftId = (): string | null => {
    const s = stateRef.current;
    if (s.status === "editing" || s.status === "saved") return s.draft.id;
    if (s.status === "saving") return s.draft.id;
    return null;
  };

  const getValue = useCallback((): { version: number; data: DraftData } | null => {
    const s = stateRef.current;
    if (s.status === "editing" || s.status === "saved" || s.status === "saving") {
      return { version: s.draft.draft_version, data: s.draft.draft_data };
    }
    return null;
  }, []);

  const saveDraftToServer = useCallback(
    async (snapshot: { version: number; data: DraftData } | null) => {
      if (!snapshot) return;
      const draftId = getDraftId();
      if (!draftId) return;

      dispatch({ type: "SAVE_START" });

      const res = await fetch(`/api/platform/social/drafts/${draftId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify({
          draft_version: snapshot.version,
          draft_data: snapshot.data,
        }),
      });

      const result = await res.json();

      if (!result.ok) {
        if (result.error?.code === "VERSION_CONFLICT") {
          const current = result.error?.details?.current_draft as Draft | null;
          if (current) {
            const stale: Draft = { id: draftId, draft_version: snapshot.version, draft_data: snapshot.data };
            dispatch({ type: "CONFLICT_DETECTED", staleDraft: stale, freshDraft: current });
          }
        }
        throw new Error(result.error?.message ?? "Save failed.");
      }

      dispatch({
        type: "SAVE_SUCCESS",
        draft: {
          id: result.data.id,
          draft_version: result.data.draft_version,
          draft_data: result.data.draft_data,
        },
        savedAt: new Date(),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [correlationId],
  );

  const draftId = getDraftId();
  const { status: saveStatus, flush } = useAutoSave({
    key: draftId ? `${AUTOSAVE_KEY_PREFIX}:${draftId}` : `${AUTOSAVE_KEY_PREFIX}:init`,
    getValue,
    save: saveDraftToServer,
    enabled: state.status === "editing" && !!draftId,
  });

  // ---------------------------------------------------------------------------
  // Close handler — flush pending save, remove search param
  // ---------------------------------------------------------------------------

  const handleClose = useCallback(async () => {
    const s = stateRef.current;
    const dirty = s.status === "editing" && s.draft !== undefined;

    // Best-effort final flush before closing.
    if (dirty) {
      try { await flush(); } catch { /* ignore — user chose to close */ }
    }

    // Remove compose search param without pushing a new history entry.
    const url = new URL(window.location.href);
    url.searchParams.delete("compose");
    url.searchParams.delete("date");
    router.replace(url.pathname + (url.search || ""), { scroll: false });
    dispatch({ type: "RESET" });
  }, [flush, router]);

  // ---------------------------------------------------------------------------
  // Keyboard: Esc closes, focus trap
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        void handleClose();
      }
      // Focus trap: Tab / Shift+Tab cycles within the modal.
      if (e.key === "Tab" && modalRef.current) {
        const focusable = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    // Auto-focus the close button on open so screen readers announce the dialog.
    firstFocusRef.current?.focus();

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const isLoading = state.status === "idle" || state.status === "loading";
  const isConflict = state.status === "recovering";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New post"
      className="fixed inset-0 z-50 flex items-stretch"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        aria-hidden="true"
        onClick={() => void handleClose()}
      />

      {/* Modal panel */}
      <div
        ref={modalRef}
        className="relative z-10 m-auto flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-white/10 bg-background shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-base font-semibold">
            {initialDraftId ? "Edit post" : "New post"}
          </h2>
          <div className="flex items-center gap-3">
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <NavIcon name="sync" size={12} className="animate-spin" />
                Saving…
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <NavIcon name="checkmark-circle" size={12} />
                Saved
              </span>
            )}
            {saveStatus === "error" && (
              <span className="text-xs text-destructive">Save failed — retrying</span>
            )}
            <button
              ref={firstFocusRef}
              type="button"
              onClick={() => void handleClose()}
              aria-label="Close composer"
              className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            >
              <NavIcon name="cross" size={18} />
            </button>
          </div>
        </div>

        {/* Conflict banner */}
        {isConflict && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 text-sm text-amber-200">
            <span className="font-medium">Draft updated elsewhere.</span>{" "}
            <button
              type="button"
              onClick={() => dispatch({ type: "CONFLICT_RESOLVED_RELOAD" })}
              className="underline hover:no-underline"
            >
              Reload latest
            </button>{" "}
            or continue editing (your changes will overwrite on next save).
          </div>
        )}

        {/* Body — split panes */}
        <div className="flex min-h-0 flex-1">
          {/* Left pane — editor (60%) */}
          <div className="flex w-[60%] flex-col overflow-y-auto border-r border-white/10 p-6">
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <NavIcon name="sync" size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Profile selector placeholder — PR 2 replaces this */}
                <div
                  className="flex min-h-[40px] items-center gap-2 rounded-md border border-dashed border-white/20 px-3 py-2 text-sm text-muted-foreground"
                  aria-label="Profile selector (coming in PR 2)"
                >
                  <NavIcon name="users" size={16} />
                  Select accounts…
                </div>

                {/* Composer textarea placeholder — PR 2 replaces this */}
                <div
                  className="min-h-[120px] rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground"
                  aria-label="Post content (coming in PR 2)"
                >
                  Paste a link or type something…
                </div>

                {/* Image upload zone placeholder */}
                <div
                  className="flex items-center justify-center gap-2 rounded-md border border-dashed border-white/20 py-8 text-sm text-muted-foreground"
                  aria-label="Image upload (coming in PR 2)"
                >
                  <NavIcon name="picture" size={20} />
                  Add an image
                </div>
              </div>
            )}
          </div>

          {/* Right pane — preview (40%) */}
          <div className="flex w-[40%] flex-col overflow-y-auto p-6">
            {/* Preview tab strip */}
            <div role="tablist" className="mb-4 flex gap-3 border-b border-white/10 pb-3">
              <button
                type="button"
                role="tab"
                className="pb-2 text-sm font-medium text-foreground border-b-2 border-pk"
                aria-selected="true"
              >
                Post preview
              </button>
              <button
                type="button"
                role="tab"
                className="pb-2 text-sm text-muted-foreground hover:text-foreground"
                aria-selected="false"
              >
                Calendar
              </button>
            </div>

            {/* Preview empty state — PR 3 replaces this */}
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <NavIcon name="picture" size={32} className="opacity-30" />
              <p>Select at least one profile and start typing to see preview</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
          {/* Mode tabs */}
          <div className="flex gap-1 rounded-md border border-white/10 p-0.5 text-xs">
            {(["Post now", "Schedule", "Save as draft"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className="rounded px-3 py-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground first:bg-white/10 first:text-foreground"
                disabled={isLoading}
              >
                {mode}
              </button>
            ))}
            <button
              type="button"
              className="rounded px-3 py-1.5 text-muted-foreground/40"
              disabled
              title="Coming soon"
            >
              Publish regularly
            </button>
          </div>

          {/* Primary action */}
          <button
            type="button"
            disabled={isLoading || state.status === "saving"}
            className="rounded-md bg-pk px-4 py-2 text-sm font-medium text-white hover:bg-pk/80 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
