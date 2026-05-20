"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ProfileSelector } from "@/components/social/composer/ProfileSelector";
import { ComposerEditor } from "@/components/social/composer/ComposerEditor";
import { PreviewCard } from "@/components/social/composer/PreviewCard";
import { MiniCalendar } from "@/components/social/composer/MiniCalendar";
import { SchedulingCard, defaultSchedulingCardValue, type SchedulingCardValue } from "@/components/social/composer/SchedulingCard";
import { UnsavedChangesDialog } from "@/components/social/composer/UnsavedChangesDialog";
import { ComposerErrorBoundary } from "@/components/social/composer/ComposerErrorBoundary";
import { EmptyState } from "@/components/ui/empty-state";
import type { Connection, Draft, SchedulingMode } from "@/lib/social/types";

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
  /** All connections available to select for this company. */
  availableConnections?: Connection[];
  /** Called when user submits. If absent, a basic Post now / Save as draft footer renders. */
  onSubmit?: (draft: Draft, mode: SchedulingMode) => Promise<void>;
  /** Called after a successful internal submit (POST /api/platform/social/drafts). */
  onSubmitSuccess?: () => void;
  /** Slot for SchedulingCard + submit row (PR E). Passed through to ComposerEditor. */
  schedulingSlot?: React.ReactNode;
}

type PreviewTab = "preview" | "calendar";

const DEFAULT_DRAFT: Draft = {
  content: "",
  media_urls: [],
  target_profile_ids: [],
  platform_variants: {},
  approval_required: false,
};

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
  availableConnections = [],
  onSubmit,
  onSubmitSuccess,
  schedulingSlot,
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

  React.useEffect(() => {
    if (open) {
      setDraft(initialDraft ?? DEFAULT_DRAFT);
      setSelectedIds(initialDraft?.target_profile_ids ?? []);
      setPreviewTab("preview");
      setActivePreviewIndex(0);
      setScheduling(defaultSchedulingCardValue());
      setSubmitError(null);
    }
  }, [open, initialDraft]);

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
    onClose();
  }

  async function handleSaveFromDialog() {
    setShowDiscard(false);
    await handleSubmit("draft");
  }

  async function handleSubmit(mode: SchedulingMode) {
    // External onSubmit takes precedence if provided.
    if (onSubmit) {
      await onSubmit(draft, mode);
      return;
    }

    if (!companyId) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        company_id: companyId,
        content: draft.content,
        media_urls: draft.media_urls,
        target_profile_ids: draft.target_profile_ids,
        platform_variants: draft.platform_variants,
        mode,
        approval_required: scheduling.approvalRequired,
        approver_user_id: draft.approver_user_id,
      };

      if (mode === "schedule" && scheduling.scheduledTimes.length > 0) {
        body.scheduled_at_list = scheduling.scheduledTimes
          .filter((r) => r.date && r.time)
          .map((r) => `${r.date}T${r.time}:00.000Z`);
      }

      if (mode === "recurring") {
        body.recurrence = scheduling.recurrence;
      }

      if (mode === "draft" && scheduling.plannedForAt?.date) {
        body.planned_for_at = `${scheduling.plannedForAt.date}T${scheduling.plannedForAt.time ?? "09:00"}:00.000Z`;
      }

      const res = await fetch("/api/platform/social/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(data?.error?.message ?? `Submit failed (${res.status})`);
      }

      onSubmitSuccess?.();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Close on Escape — respect unsaved-changes guard
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  if (!open) return null;

  const isSubmitDisabled =
    submitting ||
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
        onSubmit={() => handleSubmit(scheduling.mode)}
        submitting={submitting}
        disabled={isSubmitDisabled}
      />
    </div>
  );

  return (
    <>
      <ComposerErrorBoundary companyId={companyId}>
      <div
        className="fixed inset-0 z-50 flex flex-col bg-background"
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? "Edit post" : "New post"}
        data-testid="composer-overlay"
      >
        <div className="flex flex-1 overflow-hidden">
          {/* ── Left pane — editor ─────────────────────────────────────────── */}
          <div className="relative flex w-full flex-col overflow-y-auto border-r border-border md:w-[560px] lg:w-[600px]">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold text-foreground">
                {draft.id ? "Edit post" : "New post"}
              </h2>
              <button
                type="button"
                aria-label="Close composer"
                onClick={handleClose}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-5 px-6 py-5">
              <ProfileSelector
                available={availableConnections}
                selected={selectedIds}
                onChange={handleProfileChange}
              />

              <ComposerEditor
                draft={draft}
                onChange={setDraft}
                onSubmit={handleSubmit}
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
                <MiniCalendar
                  selectedDate={prefilledDate}
                  className="mx-auto max-w-xs"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      </ComposerErrorBoundary>

      <UnsavedChangesDialog
        open={showDiscard}
        onDiscard={handleDiscard}
        onCancel={() => setShowDiscard(false)}
        onSave={companyId ? () => void handleSaveFromDialog() : undefined}
      />
    </>
  );
}
