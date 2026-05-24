"use client";

import * as React from "react";
import { ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// LinkPreviewCard — shows an OG link card below the composer textarea.
// Matches wireframe State 10: image left or top, title, domain, dismiss.
//
// Used in Phase 4.2 / B4. The card is driven by ContentEditor's URL
// detection + debounce; preview data comes from /api/platform/social/link-preview.
// ---------------------------------------------------------------------------

export interface LinkPreviewData {
  title: string | null;
  description: string | null;
  image_url: string | null;
  domain: string;
  fetched_at: string;
}

export interface LinkPreviewCardProps {
  data: LinkPreviewData;
  url: string;
  onDismiss: () => void;
  className?: string;
}

export function LinkPreviewCard({ data, url, onDismiss, className }: LinkPreviewCardProps) {
  const title = data.title ?? data.domain;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm",
        className,
      )}
      data-testid="link-preview-card"
    >
      {/* Thumbnail — only when image_url available */}
      {data.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.image_url}
          alt=""
          className="h-16 w-24 shrink-0 rounded object-cover"
          data-testid="link-preview-image"
        />
      )}

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p
          className="font-medium text-foreground leading-snug truncate"
          data-testid="link-preview-title"
        >
          {title}
        </p>
        {data.description && (
          <p
            className="mt-0.5 text-xs text-muted-foreground line-clamp-2"
            data-testid="link-preview-description"
          >
            {data.description}
          </p>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-preview-domain"
        >
          <ExternalLink size={10} strokeWidth={1.75} aria-hidden />
          {data.domain}
        </a>
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss link preview"
        className="shrink-0 self-start text-muted-foreground hover:text-foreground transition-colors"
        data-testid="link-preview-dismiss"
      >
        <X size={14} strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LinkPreviewLoader — shown while fetching
// ---------------------------------------------------------------------------

export function LinkPreviewLoader({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex gap-3 rounded-lg border border-border bg-muted/40 p-3 animate-pulse", className)}
      data-testid="link-preview-loading"
    >
      <div className="h-16 w-24 shrink-0 rounded bg-muted" />
      <div className="min-w-0 flex-1 space-y-2 py-1">
        <div className="h-3 w-3/4 rounded bg-muted" />
        <div className="h-2.5 w-full rounded bg-muted" />
        <div className="h-2 w-1/3 rounded bg-muted" />
      </div>
    </div>
  );
}
