"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";
import { toastSuccess } from "@/lib/toast-success";
import { useAutoSave } from "@/lib/hooks/use-auto-save";
import type { DraftData } from "@/lib/platform/social/drafts";
import type { SocialConnection } from "@/lib/platform/social/connections/types";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

import { ApprovalToggle } from "./approval-toggle";
import { ComposerActions } from "./composer-actions";
import { ComposerPreview } from "./composer-preview";
import { ComposerTextarea } from "./composer-textarea";
import { ImageUploadZone } from "./image-upload-zone";
import { ProfileSelector } from "./profile-selector";
import type { ComposerMode } from "./scheduling-tabs";
import { SchedulingTabs } from "./scheduling-tabs";
import { ToolsRow } from "./tools-row";
import {
  composerReducer,
  INITIAL_STATE,
} from "./use-composer-reducer";
import type { ComposerError, Draft } from "./use-composer-reducer";

// ---------------------------------------------------------------------------
// Spec 22 PR 3 — PostComposerModal with live preview pane.
//
// PR 2 shipped all editor components. PR 3 replaces the right-pane
// placeholder with ComposerPreview (LivePreviewCard per platform +
// MiniCalendarPreview on the Calendar tab).
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
  const stateRef = useRef(state);
  stateRef.current = state;

  // Transient UI state — not persisted in draft_data per D13.
  const [mode, setMode] = useState<ComposerMode>("post_now");
  const [scheduleDate, setScheduleDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Connections list — loaded by ProfileSelector, also needed for publish call.
  const [connections, setConnections] = useState<SocialConnection[]>([]);

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
            type: "LOAD_FAIL",
            error: { message: result.error?.message ?? "Failed to initialise draft.", code: result.error?.code ?? "INTERNAL_ERROR", correlationId },
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
          type: "LOAD_FAIL",
          error: { message: err instanceof Error ? err.message : "Network error.", code: "NETWORK_ERROR", correlationId },
        });
      }
    }

    void init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers to update draft_data fields
  // ---------------------------------------------------------------------------

  const updateText = useCallback((text: string) => {
    dispatch({ type: "UPDATE_DRAFT", patch: { master_text: text } });
  }, []);

  const updateLinkUrl = useCallback((url: string | null) => {
    dispatch({ type: "UPDATE_DRAFT", patch: { link_url: url } });
  }, []);

  const updateConnections = useCallback((ids: string[]) => {
    dispatch({ type: "UPDATE_DRAFT", patch: { target_connection_ids: ids } });
  }, []);

  const updateMediaRef = useCallback((ref: import("@/lib/platform/social/drafts").MediaRef | null) => {
    dispatch({ type: "UPDATE_DRAFT", patch: { media_refs: ref ? [ref] : [] } });
  }, []);

  const updateApproval = useCallback((v: boolean) => {
    dispatch({ type: "UPDATE_DRAFT", patch: { approval_required: v } });
  }, []);

  const insertEmoji = useCallback((emoji: string) => {
    const s = stateRef.current;
    if (s.status !== "editing" && s.status !== "saved") return;
    const text = s.draft.draft_data.master_text ?? "";
    dispatch({ type: "UPDATE_DRAFT", patch: { master_text: text + emoji } });
  }, []);

  // Keep schedule in draft_data for autosave.
  const updateScheduleDate = useCallback((date: string) => {
    setScheduleDate(date);
    const s = stateRef.current;
    if (s.status !== "editing" && s.status !== "saved") return;
    const times = s.draft.draft_data.schedule?.times ?? [scheduleTime];
    dispatch({ type: "UPDATE_DRAFT", patch: { schedule: { date, times } } });
  }, [scheduleTime]);

  const updateScheduleTime = useCallback((time: string) => {
    setScheduleTime(time);
    const s = stateRef.current;
    if (s.status !== "editing" && s.status !== "saved") return;
    const date = s.draft.draft_data.schedule?.date ?? scheduleDate;
    dispatch({ type: "UPDATE_DRAFT", patch: { schedule: { date, times: [time] } } });
  }, [scheduleDate]);

  // ---------------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------------

  const getDraftId = (): string | null => {
    const s = stateRef.current;
    if (s.status === "editing" || s.status === "saved" || s.status === "saving") return s.draft.id;
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
  // Submit
  // ---------------------------------------------------------------------------

  const handleSubmit = useCallback(async () => {
    const s = stateRef.current;
    if (s.status !== "editing" && s.status !== "saved") return;

    const dd = s.draft.draft_data;
    if (!dd.master_text?.trim() && !dd.link_url?.trim()) {
      setSubmitError("Add some content before posting.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      // Flush pending autosave first.
      try { await flush(); } catch { /* non-fatal */ }

      const res = await fetch(`/api/platform/social/drafts/${s.draft.id}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-correlation-id": correlationId,
        },
        body: JSON.stringify({ company_id: companyId, mode }),
      });

      const result = await res.json();
      if (!result.ok) {
        setSubmitError(result.error?.message ?? "Submit failed.");
        return;
      }

      const postId: string = result.data.post.id;
      dispatch({ type: "PUBLISH_SUCCESS", postId });

      const scheduled: boolean = result.data.scheduled;
      const postState: string = result.data.state;

      if (mode === "draft") {
        toastSuccess("Saved as draft", { description: "Your post has been saved." });
      } else if (scheduled) {
        toastSuccess("Post scheduled", {
          description: `Scheduled for ${result.data.scheduledAt ? new Date(result.data.scheduledAt as string).toLocaleString() : "the selected time"}.`,
          action: { label: "View posts →", onClick: () => router.push("/company/social/posts") },
        });
      } else if (postState === "pending_client_approval") {
        toastSuccess("Post submitted for approval", {
          description: "An approver will review it before publishing.",
          action: { label: "View posts →", onClick: () => router.push("/company/social/posts") },
        });
      } else {
        toastSuccess("Post queued for publishing");
      }

      // Close modal.
      const url = new URL(window.location.href);
      url.searchParams.delete("compose");
      url.searchParams.delete("date");
      router.replace(url.pathname + (url.search || ""), { scroll: false });
      dispatch({ type: "RESET" });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed.");
      dispatch({
        type: "PUBLISH_FAIL",
        error: { message: err instanceof Error ? err.message : "Submit failed.", code: "SUBMIT_FAILED", correlationId },
        retryable: true,
      });
    } finally {
      setSubmitting(false);
    }
  }, [mode, companyId, correlationId, flush, router]);

  // ---------------------------------------------------------------------------
  // Close
  // ---------------------------------------------------------------------------

  const handleClose = useCallback(async () => {
    const s = stateRef.current;
    const dirty = s.status === "editing" && s.dirty;
    if (dirty) {
      try { await flush(); } catch { /* ignore */ }
    }
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
      if (e.key === "Escape") void handleClose();
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
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    firstFocusRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleClose]);

  // ---------------------------------------------------------------------------
  // Derive editor state
  // ---------------------------------------------------------------------------

  const isLoading = state.status === "idle" || state.status === "loading";
  const isLoadFailed = state.status === "load_failed";
  const isConflict = state.status === "recovering";
  const draftData: DraftData | null =
    state.status === "editing" || state.status === "saved" || state.status === "saving"
      ? state.draft.draft_data
      : null;

  const selectedPlatforms: SocialPlatform[] = (() => {
    if (!draftData || !connections.length) return [];
    const ids = new Set(draftData.target_connection_ids);
    return [...new Set(
      connections.filter((c) => ids.has(c.id)).map((c) => c.platform),
    )];
  })();

  const canSubmit = !isLoading && !submitting && !!draftData &&
    (!!draftData.master_text?.trim() || !!draftData.link_url?.trim());

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={initialDraftId ? "Edit post" : "New post"}
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
                <span className="inline-flex animate-spin">
                  <NavIcon name="sync" size={12} />
                </span>
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

        {/* Submit error banner */}
        {submitError && (
          <div className="border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive">
            {submitError}
            <button
              type="button"
              onClick={() => setSubmitError(null)}
              className="ml-2 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Body — split panes */}
        <div className="flex min-h-0 flex-1">
          {/* Left pane — editor (60%).
              Centering applied directly on the pane (which has a well-defined
              height from the flex-row body) so items-center/justify-center
              works reliably in the loading/error states without a flex-1 inner
              wrapper that can collapse inside overflow-y-auto. */}
          <div
            className={cn(
              "flex w-[60%] flex-col border-r border-white/10",
              (isLoading || isLoadFailed) && "items-center justify-center",
            )}
          >
            {isLoadFailed && state.status === "load_failed" ? (
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-sm text-destructive">
                  {state.error.message}
                </p>
                <button
                  type="button"
                  onClick={() => void handleClose()}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Close
                </button>
              </div>
            ) : isLoading ? (
              <span className="inline-flex animate-spin text-muted-foreground">
                <NavIcon name="sync" size={24} />
              </span>
            ) : (
              <div className="flex flex-col gap-4 overflow-y-auto p-6">
                {/* Profile selector */}
                <ProfileSelector
                  companyId={companyId}
                  selectedIds={draftData?.target_connection_ids ?? []}
                  onChange={updateConnections}
                  onConnectionsLoaded={setConnections}
                  disabled={submitting}
                />

                {/* Composer textarea */}
                <ComposerTextarea
                  value={draftData?.master_text ?? ""}
                  linkUrl={draftData?.link_url}
                  selectedPlatforms={selectedPlatforms}
                  onChange={updateText}
                  onLinkUrl={updateLinkUrl}
                  disabled={submitting}
                />

                {/* Image upload zone */}
                <ImageUploadZone
                  companyId={companyId}
                  mediaRef={draftData?.media_refs[0] ?? null}
                  onSelect={updateMediaRef}
                  disabled={submitting}
                />

                {/* Tools row */}
                <ToolsRow
                  onEmojiInsert={insertEmoji}
                  disabled={submitting}
                />

                {/* Approval toggle */}
                <ApprovalToggle
                  value={draftData?.approval_required ?? false}
                  onChange={updateApproval}
                  disabled={submitting}
                />
              </div>
            )}
          </div>

          {/* Right pane — preview (40%) */}
          <div className="flex w-[40%] flex-col overflow-y-auto">
            <ComposerPreview
              draftData={draftData}
              selectedPlatforms={selectedPlatforms}
              connections={connections}
              mode={mode}
              scheduleDate={scheduleDate}
              scheduleTime={scheduleTime}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-4">
          {/* Scheduling tabs */}
          <SchedulingTabs
            mode={mode}
            scheduleDate={scheduleDate}
            scheduleTime={scheduleTime}
            onModeChange={setMode}
            onScheduleDate={updateScheduleDate}
            onScheduleTime={updateScheduleTime}
            disabled={isLoading || submitting}
          />

          {/* Primary action */}
          <ComposerActions
            mode={mode}
            submitting={submitting}
            disabled={!canSubmit}
            onSubmit={() => void handleSubmit()}
          />
        </div>
      </div>
    </div>
  );
}
