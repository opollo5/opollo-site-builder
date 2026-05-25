"use client";

import * as React from "react";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaTile } from "@/components/social/composer/MediaTile";

// ---------------------------------------------------------------------------
// MediaTray — row of MediaTile thumbnails + "Add more" tile.
// ---------------------------------------------------------------------------

export interface MediaTrayProps {
  urls: string[];
  onRemove: (index: number) => void;
  onRequestUpload: () => void;
  gifIndices?: Set<number>;
  uploading?: boolean;
  maxFiles?: number;
  className?: string;
  /** Hide the "Add more" tile and the per-tile remove affordance. */
  readOnly?: boolean;
}

export function MediaTray({
  urls,
  onRemove,
  onRequestUpload,
  gifIndices,
  uploading = false,
  maxFiles = 4,
  className,
  readOnly = false,
}: MediaTrayProps) {
  if (urls.length === 0 && !uploading) return null;

  return (
    <div
      className={cn("flex flex-wrap gap-2", className)}
      data-testid="media-tray"
    >
      {urls.map((url, i) => (
        <MediaTile
          key={url}
          url={url}
          index={i}
          onRemove={readOnly ? undefined : onRemove}
          isGif={gifIndices?.has(i)}
        />
      ))}

      {/* Uploading spinner tile */}
      {uploading && (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
          <Loader2 size={20} strokeWidth={1.75} className="animate-spin text-muted-foreground" aria-hidden />
        </div>
      )}

      {/* Add more tile */}
      {!readOnly && urls.length < maxFiles && !uploading && (
        <button
          type="button"
          aria-label="Add media"
          onClick={onRequestUpload}
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          data-testid="media-tray-add"
        >
          <Plus size={20} strokeWidth={1.75} aria-hidden />
        </button>
      )}
    </div>
  );
}
