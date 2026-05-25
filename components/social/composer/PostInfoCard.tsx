"use client";

import * as React from "react";
import { ExternalLink, BarChart3, RefreshCcw, Repeat2, Trash2, AlertTriangle } from "lucide-react";
import type { DraftState } from "@/lib/social/types";
import {
  canPerform,
  type PostState,
} from "@/lib/social/post-state-actions";

// ---------------------------------------------------------------------------
// PostInfoCard — read-only / state-aware footer that replaces SchedulingCard
// when the post is not in an editable state.
//
// Renders the actions allowed by lib/social/post-state-actions.ts for the
// post's state. Specifically NEVER calls a bundle.social unpublish API —
// "Delete from records" only removes the Opollo database row. The
// confirmation copy spells this out explicitly.
//
// Wired by ComposerOverlay when isReadOnlyState(editOriginalState) is true,
// or when state === 'failed' (failed is editable but adds Retry publish).
// ---------------------------------------------------------------------------

export interface PostInfoCardProps {
  state: DraftState;
  publishedAt: string | null;
  publishedUrl: string | null;
  /** Called when the user confirms "Delete from records" — caller owns the DELETE call. */
  onDeleteFromRecords: () => void;
  /** Called when the user clicks "Repost as new" — caller creates a fresh draft. */
  onRepostAsNew: () => void;
  /** Called when the user clicks "Retry publish" (failed state only). */
  onRetryPublish?: () => void;
  /** Called when the user clicks "View analytics". */
  onViewAnalytics?: () => void;
  /** Failure message for state='failed'. */
  failureReason?: string;
}

function formatPublishedAt(iso: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function stateLabel(state: DraftState): string {
  switch (state) {
    case "published":
      return "Published";
    case "publishing":
      return "Publishing…";
    case "pending_approval":
      return "Waiting for approval";
    case "recurring":
      return "Recurring";
    case "paused":
      return "Paused";
    case "failed":
      return "Failed to publish";
    case "rejected":
      return "Changes requested";
    default:
      return state;
  }
}

export function PostInfoCard({
  state,
  publishedAt,
  publishedUrl,
  onDeleteFromRecords,
  onRepostAsNew,
  onRetryPublish,
  onViewAnalytics,
  failureReason,
}: PostInfoCardProps) {
  const postState = state as PostState;
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4"
      data-testid="composer-readonly-banner"
      data-post-state={state}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {stateLabel(state)}
          </p>
          {publishedAt && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatPublishedAt(publishedAt)}
            </p>
          )}
          {state === "failed" && failureReason && (
            <p className="mt-1 flex items-start gap-1 text-xs text-destructive">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
              <span>{failureReason}</span>
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canPerform(postState, "view_on_platform") && publishedUrl && (
          <a
            href={publishedUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="view-on-platform-link"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 transition-colors"
          >
            <ExternalLink size={14} aria-hidden />
            View on platform
          </a>
        )}

        {canPerform(postState, "view_analytics") && onViewAnalytics && (
          <button
            type="button"
            onClick={onViewAnalytics}
            data-testid="view-analytics-link"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 transition-colors"
          >
            <BarChart3 size={14} aria-hidden />
            View analytics
          </button>
        )}

        {canPerform(postState, "repost_as_new") && (
          <button
            type="button"
            onClick={onRepostAsNew}
            data-testid="repost-as-new-button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 transition-colors"
          >
            <Repeat2 size={14} aria-hidden />
            Repost as new
          </button>
        )}

        {canPerform(postState, "retry_publish") && onRetryPublish && (
          <button
            type="button"
            onClick={onRetryPublish}
            data-testid="retry-publish-button"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RefreshCcw size={14} aria-hidden />
            Retry publish
          </button>
        )}

        {canPerform(postState, "delete_from_records") && !confirmingDelete && (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            data-testid="delete-from-records-button"
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 size={14} aria-hidden />
            Delete from records
          </button>
        )}
      </div>

      {confirmingDelete && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs"
          data-testid="delete-from-records-confirm"
        >
          {/*
            CRITICAL UX COPY — do not soften. The published post stays live
            on the social platform; we only delete Opollo's database row.
            We never call any bundle.social unpublish API.
          */}
          <p className="font-medium text-foreground">
            Remove this post from Opollo?
          </p>
          <p className="mt-0.5 text-muted-foreground">
            This will remove the post from Opollo. <strong>The post will
            remain visible on the social platform.</strong> Opollo does not
            unpublish posts on your behalf.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                onDeleteFromRecords();
              }}
              data-testid="delete-from-records-confirm-yes"
              className="rounded-md bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, remove from Opollo
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
