"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// MediaTray — presentational thumbnail strip with upload trigger.
// Accepts an external `onUpload` trigger ref so ContentEditor can open the
// file picker via its own file input (shared between MediaTray "+" and ToolsRow
// "Media" button).
// ---------------------------------------------------------------------------

export interface MediaTrayProps {
  /** Signed URLs already uploaded. */
  urls: string[];
  /** Called when the user removes a thumbnail. */
  onRemove: (index: number) => void;
  /** Called to trigger the file picker from outside (e.g. ToolsRow "Media"). */
  onRequestUpload: () => void;
  uploading?: boolean;
  maxFiles?: number;
  className?: string;
}

export function MediaTray({
  urls,
  onRemove,
  onRequestUpload,
  uploading = false,
  maxFiles = 4,
  className,
}: MediaTrayProps) {
  if (urls.length === 0 && !uploading) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {urls.map((url, i) => (
        <div
          key={url}
          className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`Media ${i + 1}`} className="h-full w-full object-cover" />
          <button
            type="button"
            aria-label={`Remove image ${i + 1}`}
            onClick={() => onRemove(i)}
            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      ))}

      {urls.length < maxFiles && (
        <button
          type="button"
          aria-label="Add media"
          onClick={onRequestUpload}
          disabled={uploading}
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {uploading ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
