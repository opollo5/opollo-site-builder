"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// MediaTile — 80×80 thumbnail with hover-reveal trash + optional GIF badge.
// ---------------------------------------------------------------------------

export interface MediaTileProps {
  url: string;
  index: number;
  onRemove: (index: number) => void;
  isGif?: boolean;
  className?: string;
}

export function MediaTile({ url, index, onRemove, isGif = false, className }: MediaTileProps) {
  return (
    <div
      className={cn(
        "group relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted",
        className,
      )}
      data-testid={`media-tile-${index}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Media ${index + 1}`}
        className="h-full w-full object-cover"
        loading="lazy"
      />

      {/* GIF badge */}
      {isGif && (
        <span
          className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-xs font-bold uppercase leading-none tracking-wide text-white"
          aria-label="GIF"
        >
          GIF
        </span>
      )}

      {/* Hover-reveal trash */}
      <button
        type="button"
        aria-label={`Remove media ${index + 1}`}
        onClick={() => onRemove(index)}
        className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 size={16} strokeWidth={1.75} className="text-white" aria-hidden />
      </button>
    </div>
  );
}
