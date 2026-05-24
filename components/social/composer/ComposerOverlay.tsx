"use client";

import * as React from "react";
import { ChevronLeft, X } from "lucide-react";
import { mutate as swrMutate } from "swr";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { ProfileSelector } from "@/components/social/composer/ProfileSelector";
import { ComposerEditor } from "@/components/social/composer/ComposerEditor";
import { PreviewCard } from "@/components/social/composer/PreviewCard";
import { SocialCalendarGrid } from "@/components/social/calendar/SocialCalendarGrid";
import { SchedulingCard, defaultSchedulingCardValue, type SchedulingCardValue } from "@/components/social/composer/SchedulingCard";
import { UnsavedChangesDialog } from "@/components/social/composer/UnsavedChangesDialog";
import { ComposerErrorBoundary } from "@/components/social/composer/ComposerErrorBoundary";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill } from "@/components/ui/pill";
import { SocialPlatformIcon } from "@/components/ui/SocialPlatformIcon";
import type { Connection, Draft, DraftState, Platform, SchedulingMode } from "@/lib/social/types";
import type { SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";

// ---------------------------------------------------------------------------
// ComposerOverlay — split-pane shell (PR C + PR D + PR E).
//
// PR E adds:
//   - Internal SchedulingCard slot (mode, approval, recurrence, etc.)
//   - API submit → POST /api/platform/social/drafts (V2 path)
//   - UnsavedChangesDialog when closing with dirty content
//   - onSubmitSuccess callback so callers can react (e.g. close + toast)
//
// External `schedulingSlot` prop still takes precedence if provided.
//
// CLAUDE-ASSUMPTION: ComposerOverlay internally builds the scheduling slot
// when schedulingSlot is absent. This avoids forcing every consumer to wire
// SchedulingCard themselves; the slot override exists for advanced use cases.
// ---------------------------------------------------------------------------

export interface ComposerOverlayProps {
  open: boolean;
  onClose: () => void;
  initialDraft?: Draft;
  prefilledDate?: Date;
  /** Company ID — required for media upload and AI assist. */
  companyId?: string;
  /** IANA timezone string for the company (e.g. "Australia/Melbourne"). Used for scheduling. */
  companyTimezone?: string;
  /** All connections available to select for this company. */
  availableConnections?: Connection[];
  /** Called when user submits. If absent, a basic Post now / Save as draft footer renders. */
  onSubmit?: (draft: Draft, mode: SchedulingMode) => Promise<void>;
  /** Called after a successful internal submit (POST /api/platform/social/drafts). */
  onSubmitSuccess?: () => void;
  /** Slot for SchedulingCard + submit row (PR E). Passed through to ComposerEditor. */
  schedulingSlot?: React.ReactNode;
  /** Optional insights sidebar panel rendered to the right of the preview pane at xl+ screens. */
  insightsSidebar?: React.ReactNode;
  /** Original state of the draft being edited (for header copy + convert-to-draft action). */
  editOriginalState?: DraftState;
  /** Failure reason shown as an error banner when editOriginalState === 'failed'. */
  failureReason?: string;
  /** Called when user clicks a post chip in the calendar tab. Caller handles URL navigation. */
  onNavigateToPost?: (postId: string) => void;
}

type PreviewTab = "preview" | "calendar";

const SHORTCUTS = [
  { keys: "⌘↵",  label: "Submit post" },
  { keys: "⌘S",  label: "Save as draft" },
  { keys: "⌘⇧S", label: "Schedule post" },
  { keys: "⌘K",  label: "Focus editor" },
  { keys: "⌘E",  label: "Toggle emoji panel" },
  { keys: "⌘I",  label: "Open media picker" },
  { keys: "⌘1–5",label: "Switch preview tab" },
  { keys: "Esc", label: "Close composer" },
  { keys: "?",   label: "Show shortcuts" },
] as const;

const DEFAULT_DRAFT: Draft = {
  content: "",
  media_urls: [],
  target_profile_ids: [],
  platform_variants: {},
  approval_required: false,
};

// Converts a UTC ISO string into a SchedulingCardValue using the company's IANA timezone.
// Exported for unit testing.
export function schedulingCardValueFromIso(
  iso: string | null | undefined,
  tz: string,
): SchedulingCardValue {
  const base = defaultSchedulingCardValue();
  if (!iso) return base;
  try {
    const parsed = new Date(iso);
    if (isNaN(parsed.getTime())) return base;
    const local = toZonedTime(parsed, tz);
    const yyyy = local.getFullYear();
    const mm = String(local.getMonth() + 1).padStart(2, "0");
    const dd = String(local.getDate()).padStart(2, "0");
    const hh = String(local.getHours()).padStart(2, "0");
    const min = String(local.getMinutes()).padStart(2, "0");
    return {
      ...base,
      mode: "schedule",
      scheduledTimes: [{ date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` }],
    };
  } catch {
    return base;
  }
}

function platformToIconKey(p: Platform): SocialPlatformIconKey {
  return p.toUpperCase().replace("GOOGLE_BUSINESS_PROFILE", "GOOGLE_BUSINESS") as SocialPlatformIconKey;
}

function isDirty(draft: Draft): boolean {
  return (
    draft.content.trim().length > 0 ||
    draft.media_urls.length > 0 ||
    draft.target_profile_ids.length > 0
  );
}

export function ComposerOverlay({
  open,
  onClose,
  initialDraft,
  prefilledDate,
  companyId = "",
  companyTimezone = "UTC",
  availableConnections = [],
  onSubmit,
  onSubmitSuccess,
  schedulingSlot,
  insightsSidebar,
  editOriginalState,
  failureReason,
  onNavigateToPost,
}: ComposerOverlayProps) {
  const [draft, setDraft] = React.useState<Draft>(initialDraft ?? DEFAULT_DRAFT);
  const [selectedIds, setSelectedIds] = React.useState<string[]>(
    initialDraft?.target_profile_ids ?? [],
  );
  const [previewTab, setPreviewTab] = React.useState<PreviewTab>("preview");
  const [activePreviewIndex, setActivePreviewIndex] = React.useState(0);

  // Scheduling state (internal slot — used when schedulingSlot prop is absent)
  const [scheduling, setScheduling] = React.useState<SchedulingCardValue>(
    () => defaultSchedulingCardValue(),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  // Unsaved-changes guard
  const [showDiscard, setShowDiscard] = React.useState(false);
  // When the dialog was triggered by a Calendar chip click, holds the target post ID.
  // null means the dialog was triggered by the close action.
  const [pendingNavigateId, setPendingNavigateId] = React.useState<string | null>(null);
  // Keyboard shortcuts panel
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  // Overlay ref for scoped querySelector
  const overlayRef = React.useRef<HTMLDivElement>(null);

  // Track the last draft we hydrated from, so we can do a dirty-check before
  // re-hydrating when the user navigates to a different post via the calendar tab.
  const lastHydratedDraftRef = React.useRef<Draft | undefined>(undefined);
  // Keep a ref to the live draft value so the hydration effect can read it without
  // adding draft to the dep array (which would fire on every keystroke).
  const draftRef = React.useRef<Draft>(draft);
  React.useEffect(() => { draftRef.current = draft; });

  React.useEffect(() => {
    if (!open) {
      lastHydratedDraftRef.current = undefined;
      return;
    }

    const incomingId = initialDraft?.id;
    const lastHydrated = lastHydratedDraftRef.current;

    // Already hydrated from this exact draft — no-op.
    if (incomingId !== undefined && incomingId === lastHydrated?.id) return;

    // Mid-session swap guard: if the user has edited the currently-loaded draft,
    // don't overwrite their work when a different initialDraft arrives.
    if (lastHydrated !== undefined) {
      const cur = draftRef.current;
      const edited =
        cur.content !== lastHydrated.content ||
        cur.media_urls.length !== lastHydrated.media_urls.length ||
        cur.target_profile_ids.length !== lastHydrated.target_profile_ids.length;
      if (edited) return;
    }

    const toHydrate = initialDraft ?? DEFAULT_DRAFT;
    lastHydratedDraftRef.current = toHydrate;
    setDraft(toHydrate);
    setSelectedIds(toHydrate.target_profile_ids);
    setPreviewTab("preview");
    setActivePreviewIndex(0);
    setScheduling(schedulingCardValueFromIso(initialDraft?.scheduled_at, companyTimezone));
    setSubmitError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDraft, companyTimezone]);

  const selectedConnections = availableConnections.filter((c) =>
    selectedIds.includes(c.id),
  );
  const previewConnection = selectedConnections[activePreviewIndex] ?? null;

  function handleProfileChange(ids: string[]) {
    setSelectedIds(ids);
    setDraft((d) => ({ ...d, target_profile_ids: ids }));
    setActivePreviewIndex(0);
  }

  function handleClose() {
    if (isDirty(draft)) {
      setShowDiscard(true);
    } else {
      onClose();
    }
  }

  function handleDiscard() {
    setShowDiscard(false);
    const navId = pendingNavigateId;
    setPendingNavigateId(null);
    if (navId) {
      onNavigateToPost?.(navId);
    } else {
      onClose();
    }
  }

  async function handleSaveFromDialog() {
    setShowDiscard(false);
    const navId = pendingNavigateId;
    setPendingNavigateId(null);
    const saved = await handleSubmit("draft");
    // handleSubmit calls onClose() on success. If triggered by a chip click,
    // re-open the composer at the intended post after the save completes.
    if (saved && navId) {
      onNavigateToPost?.(navId);
    }
  }

  function handleChipClick(postId: string) {
    if (isDirty(draft)) {
      setPendingNavigateId(postId);
      setShowDiscard(true);
    } else {
      onNavigateToPost?.(postId);
    }
  }

  async function handleConvertToDraft() {
    if (!draft.id) return;
    try {
      const res = await fetch(`/api/platform/social/drafts/${draft.id}/convert-to-draft`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Convert failed (${res.status})`);
      void swrMutate(
        (key) => typeof key === "string" && key.includes("/api/platform/social/drafts/calendar-view"),
      );
      onClose();
    } catch {
      // ignore — UI shows nothing on failure; user can retry
    }
  }

  async function handleSubmit(mode: SchedulingMode): Promise<boolean> {
    // External onSubmit takes precedence if provided.
    if (onSubmit) {
      await onSubmit(draft, mode);
      return true;
    }

    if (!companyId) return false;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const isEdit = !!draft.id;

      // Convert local wall-clock times to UTC using the company's IANA timezone.
      const scheduledAtList =
        mode === "schedule" && scheduling.scheduledTimes.length > 0
          ? scheduling.scheduledTimes
              .filter((r) => r.date && r.time)
              .map((r) =>
                fromZonedTime(`${r.date}T${r.time}:00`, companyTimezone).toISOString(),
              )
          : undefined;

      const plannedForAt =
        mode === "draft" && scheduling.plannedForAt?.date
          ? fromZonedTime(
              `${scheduling.plannedForAt.date}T${scheduling.plannedForAt.time ?? "09:00"}:00`,
              companyTimezone,
            ).toISOString()
          : undefined;

      let res: Response;

      if (isEdit) {
        // PATCH existing draft — updates in place, preserves draft_version for CAS.
        const patchBody: Record<string, unknown> = {
          draft_version: draft.draft_version,
          content: draft.content,
          media_urls: draft.media_urls,
          target_profile_ids: draft.target_profile_ids,
          platform_variants: draft.platform_variants,
          mode,
          approval_required: scheduling.approvalRequired,
          approver_user_id: draft.approver_user_id ?? null,
        };
        if (scheduledAtList && scheduledAtList.length > 0) {
          patchBody.scheduled_at = scheduledAtList[0];
        }
        if (plannedForAt) patchBody.planned_for_at = plannedForAt;

        res = await fetch(`/api/platform/social/drafts/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchBody),
        });
      } else {
        // POST new draft.
        const postBody: Record<string, unknown> = {
          company_id: companyId,
          content: draft.content,
          media_urls: draft.media_urls,
          target_profile_ids: draft.target_profile_ids,
          platform_variants: draft.platform_variants,
          mode,
          approval_required: scheduling.approvalRequired,
          approver_user_id: draft.approver_user_id,
        };
        if (scheduledAtList) postBody.scheduled_at_list = scheduledAtList;
        if (mode === "recurring") postBody.recurrence = scheduling.recurrence;
        if (plannedForAt) postBody.planned_for_at = plannedForAt;

        res = await fetch("/api/platform/social/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postBody),
        });
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data?.error?.message ?? `Submit failed (${res.status})`);
      }

      // Revalidate any mounted calendar-view SWR subscriptions (CalendarShell + MonthCalendar)
      void swrMutate(
        (key) => typeof key === "string" && key.includes("/api/platform/social/drafts/calendar-view"),
      );
      onSubmitSuccess?.();
      onClose();
      return true;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  // Keyboard shortcuts
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      if (e.key === "Escape" && !e.defaultPrevented) {
        if (showShortcuts) { setShowShortcuts(false); return; }
        handleClose();
        return;
      }

      // ? key — show shortcuts panel (only when not typing in an input)
      if (e.key === "?" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setShowShortcuts((s) => !s);
        return;
      }

      if (!meta) return;

      switch (e.key) {
        case "Enter":
          e.preventDefault();
          if (e.shiftKey) {
            void handleSubmit("schedule");
          } else {
            void handleSubmit(scheduling.mode);
          }
          break;
        case "s":
        case "S":
          e.preventDefault();
          if (e.shiftKey) {
            void handleSubmit("schedule");
          } else {
            void handleSubmit("draft");
          }
          break;
        case "k":
        case "K":
          e.preventDefault();
          overlayRef.current
            ?.querySelector<HTMLTextAreaElement>('[data-testid="content-textarea"]')
            ?.focus();
          break;
        case "e":
        case "E":
          e.preventDefault();
          overlayRef.current
            ?.querySelector<HTMLButtonElement>('[data-testid="composer-tool-emoji"]')
            ?.click();
          break;
        case "i":
        case "I":
          e.preventDefault();
          overlayRef.current
            ?.querySelector<HTMLButtonElement>('[data-testid="composer-tool-media"]')
            ?.click();
          break;
        case "1": case "2": case "3": case "4": case "5": {
          e.preventDefault();
          const idx = parseInt(e.key, 10) - 1;
          setActivePreviewIndex(idx);
          break;
        }
        default:
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, scheduling, showShortcuts]);

  if (!open) return null;

  const isPublishing = editOriginalState === "publishing";

  const isSubmitDisabled =
    submitting ||
    isPublishing ||
    draft.target_profile_ids.length === 0 ||
    draft.content.trim().length === 0;

  const internalSchedulingSlot = (
    <div className="flex flex-col gap-2">
      {submitError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      )}
      {draft.target_profile_ids.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Select at least one account to post to.
        </p>
      )}
      <SchedulingCard
        value={scheduling}
        onChange={setScheduling}
        onSubmit={async () => { await handleSubmit(scheduling.mode); }}
        submitting={submitting}
        disabled={isSubmitDisabled}
        disabledTooltip={
          draft.target_profile_ids.length === 0
            ? "Select at least one account to post to"
            : undefined
        }
      />
      {editOriginalState === "scheduled" && (
        <button
          type="button"
          onClick={() => void handleConvertToDraft()}
          data-testid="convert-to-draft-btn"
          className="w-full rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
        >
          Convert to draft
        </button>
      )}
    </div>
  );

  return (
    <>
      <ComposerErrorBoundary companyId={companyId}>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-50 flex flex-col bg-background c3-modal-in"
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? "Edit post" : "New post"}
        data-testid="composer-overlay"
      >
        <div className="relative flex flex-1 overflow-hidden">
          {/* ── Close button — absolute top-right of content area ────────────── */}
          <button
            type="button"
            aria-label="Close composer"
            onClick={handleClose}
            data-testid="composer-close-btn"
            className="absolute right-4 top-4 z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-[120ms] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          >
            <X size={24} strokeWidth={1.75} aria-hidden />
          </button>
          {/* ── Left pane — editor ─────────────────────────────────────────── */}
          <div className="relative flex w-full flex-col overflow-y-auto border-r border-border md:w-[560px] lg:w-[600px]">
            <div className="flex items-center gap-2 border-b border-border px-4 py-4">
              {/* Back button */}
              <button
                type="button"
                aria-label="Back"
                onClick={handleClose}
                data-testid="composer-back-btn"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-[120ms] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
              >
                <ChevronLeft size={20} aria-hidden />
              </button>

              {/* Title */}
              <h2 className="flex-1 text-base font-semibold text-foreground min-w-0">
                {editOriginalState ? (
                  <span className="flex items-center gap-1.5 min-w-0 truncate">
                    <span className="shrink-0">Edit post</span>
                    {selectedConnections.length > 0 && (
                      <>
                        <span className="shrink-0 text-muted-foreground font-normal">for</span>
                        <SocialPlatformIcon platform={platformToIconKey(selectedConnections[0]!.platform)} size={24} />
                        <span className="truncate">{selectedConnections[0]!.account_name}</span>
                        {selectedConnections.length > 1 && <span className="shrink-0">…</span>}
                      </>
                    )}
                    {editOriginalState === "failed" && (
                      <span className="shrink-0 text-destructive font-medium">· Failed</span>
                    )}
                    {isPublishing && (
                      <Pill variant="warning" className="shrink-0 text-xs">Publishing…</Pill>
                    )}
                  </span>
                ) : draft.id ? "Edit post" : "New post"}
              </h2>

              {/* Keyboard shortcuts button */}
              <button
                type="button"
                aria-label="Keyboard shortcuts"
                title="Keyboard shortcuts (?)"
                onClick={() => setShowShortcuts((s) => !s)}
                data-testid="composer-shortcuts-btn"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M9 7h6" /><path d="M12 17V11" /><rect width="20" height="16" x="2" y="4" rx="2" /><path d="M6 11h2" /><path d="M16 11h2" />
                </svg>
              </button>
            </div>

            {/* Keyboard shortcuts panel */}
            {showShortcuts && (
              <div
                className="absolute left-0 right-0 top-[65px] z-10 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-4 c3-panel-in shadow-md"
                data-testid="composer-shortcuts-panel"
              >
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wide">Keyboard shortcuts</p>
                  <button
                    type="button"
                    onClick={() => setShowShortcuts(false)}
                    aria-label="Close shortcuts panel"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 sm:grid-cols-3">
                  {SHORTCUTS.map(({ keys, label }) => (
                    <div key={keys} className="flex items-center gap-2">
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {keys}
                      </kbd>
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={cn("flex flex-1 flex-col gap-5 px-6 py-5", isPublishing && "pointer-events-none opacity-60")}>
              <ProfileSelector
                available={availableConnections}
                selected={selectedIds}
                onChange={handleProfileChange}
              />

              {editOriginalState === "failed" && failureReason && (
                <div
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm"
                  data-testid="failure-banner"
                >
                  <p className="font-medium text-destructive">Publish failed</p>
                  <p className="mt-0.5 text-xs text-destructive/80">{failureReason}</p>
                </div>
              )}

              <ComposerEditor
                draft={draft}
                onChange={setDraft}
                onSubmit={async (mode) => { await handleSubmit(mode); }}
                companyId={companyId}
                selectedConnections={selectedConnections}
                schedulingSlot={schedulingSlot ?? internalSchedulingSlot}
              />
            </div>
          </div>

          {/* ── Right pane — preview / calendar ────────────────────────────── */}
          <div className="hidden flex-1 flex-col overflow-y-auto bg-muted/30 md:flex">
            <div className="flex items-center gap-1 border-b border-border bg-background px-6 py-3">
              {(["preview", "calendar"] as PreviewTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setPreviewTab(tab)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    previewTab === tab
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab === "preview" ? "Post preview" : "Calendar"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {previewTab === "preview" ? (
                previewConnection ? (
                  <>
                    {selectedConnections.length > 1 && (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {selectedConnections.map((c, i) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setActivePreviewIndex(i)}
                            className={cn(
                              "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                              i === activePreviewIndex
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {c.account_name}
                          </button>
                        ))}
                      </div>
                    )}
                    <PreviewCard
                      platform={previewConnection.platform}
                      content={draft.platform_variants[previewConnection.platform]?.content ?? draft.content}
                      mediaUrls={draft.media_urls}
                      connection={previewConnection}
                    />
                  </>
                ) : (
                  <EmptyState
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect width="18" height="18" x="3" y="3" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                      </svg>
                    }
                    title="Select a profile to preview"
                    body="Pick at least one social profile above. Your post will render here exactly as it will appear when published."
                  />
                )
              ) : (
                <SocialCalendarGrid
                  companyId={companyId}
                  selectedDate={prefilledDate}
                  highlightPostId={initialDraft?.id}
                  onClickPost={onNavigateToPost ? (post) => handleChipClick(post.id) : undefined}
                />
              )}
            </div>
          </div>

          {/* ── Insights sidebar — xl+ only ─────────────────────────────────── */}
          {insightsSidebar}
        </div>
      </div>

      </ComposerErrorBoundary>

      <UnsavedChangesDialog
        open={showDiscard}
        onDiscard={handleDiscard}
        onCancel={() => { setShowDiscard(false); setPendingNavigateId(null); }}
        onSave={companyId ? () => void handleSaveFromDialog() : undefined}
      />
    </>
  );
}
