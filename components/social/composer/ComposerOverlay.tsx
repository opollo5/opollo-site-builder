"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ProfileSelector } from "@/components/social/composer/ProfileSelector";
import { ComposerEditor } from "@/components/social/composer/ComposerEditor";
import { PreviewCard } from "@/components/social/composer/PreviewCard";
import { MiniCalendar } from "@/components/social/composer/MiniCalendar";
import { EmptyState } from "@/components/ui/empty-state";
import type { Connection, Draft, SchedulingMode } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// ComposerOverlay — split-pane shell (PR C + PR D).
//
// Left pane:  profile selector + ComposerEditor (content + variants + tools).
// Right pane: preview / calendar tabs with live preview.
//
// SchedulingCard + ApprovalToggle slot into ComposerEditor.schedulingSlot in PR E.
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

export function ComposerOverlay({
  open,
  onClose,
  initialDraft,
  prefilledDate,
  companyId = "",
  availableConnections = [],
  onSubmit,
  schedulingSlot,
}: ComposerOverlayProps) {
  const [draft, setDraft] = React.useState<Draft>(initialDraft ?? DEFAULT_DRAFT);
  const [selectedIds, setSelectedIds] = React.useState<string[]>(
    initialDraft?.target_profile_ids ?? [],
  );
  const [previewTab, setPreviewTab] = React.useState<PreviewTab>("preview");
  const [activePreviewIndex, setActivePreviewIndex] = React.useState(0);

  React.useEffect(() => {
    if (open) {
      setDraft(initialDraft ?? DEFAULT_DRAFT);
      setSelectedIds(initialDraft?.target_profile_ids ?? []);
      setPreviewTab("preview");
      setActivePreviewIndex(0);
    }
  }, [open, initialDraft]);

  const selectedConnections = availableConnections.filter((c) =>
    selectedIds.includes(c.id),
  );
  const previewConnection = selectedConnections[activePreviewIndex] ?? null;

  // Sync selected IDs into draft.target_profile_ids
  function handleProfileChange(ids: string[]) {
    setSelectedIds(ids);
    setDraft((d) => ({ ...d, target_profile_ids: ids }));
    setActivePreviewIndex(0);
  }

  async function handleSubmit(mode: SchedulingMode) {
    await onSubmit?.(draft, mode);
  }

  // Close on Escape
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Compose post"
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
              onClick={onClose}
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
              schedulingSlot={schedulingSlot}
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
                    content={draft.content}
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
  );
}
