"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Connection, Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// Composer ProfileSelector — chip row + "Add profile" affordance.
// Controlled component: caller owns selected[] + onChange.
// ---------------------------------------------------------------------------

export interface ProfileSelectorProps {
  available: Connection[];
  selected: string[];
  onChange: (ids: string[]) => void;
  className?: string;
}

// Minimal colour tokens per platform — used for the chip ring when selected.
const PLATFORM_COLOR: Record<Platform, string> = {
  linkedin: "#0A66C2",
  facebook: "#1877F2",
  instagram: "#DD2A7B",
  x: "#000000",
  google_business_profile: "#4584ED",
  pinterest: "#E60023",
  tiktok: "#010101",
};

// Platform SVG icons (22 × 22 viewBox, matching wireframe sprites).
function PlatformIcon({ platform, size = 22 }: { platform: Platform; size?: number }) {
  switch (platform) {
    case "linkedin":
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <rect width="22" height="22" rx="3" fill="#0A66C2" />
          <path fill="white" d="M5.5 8.5h2.6v8H5.5zm1.3-3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm3.7 3.5h2.5v1.1c.4-.7 1.4-1.4 2.8-1.4 3 0 3.6 2 3.6 4.6v4.7h-2.6v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2v4.3h-2.5z" />
        </svg>
      );
    case "facebook":
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <circle cx="11" cy="11" r="11" fill="#1877F2" />
          <path fill="white" d="M14.9 14l.4-2.9h-2.8V9.1c0-.8.4-1.5 1.6-1.5h1.3V5.1S14.3 4.9 13.2 4.9c-2.3 0-3.8 1.4-3.8 3.9V11H6.9v2.9h2.5V21h3.1v-7h2.4z" />
        </svg>
      );
    case "instagram":
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <defs>
            <linearGradient id="ig-composer-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#F58529" />
              <stop offset=".3" stopColor="#DD2A7B" />
              <stop offset=".6" stopColor="#8134AF" />
              <stop offset="1" stopColor="#515BD4" />
            </linearGradient>
          </defs>
          <rect width="22" height="22" rx="6" fill="url(#ig-composer-grad)" />
          <rect x="5" y="5" width="12" height="12" rx="4" fill="none" stroke="white" strokeWidth="1.6" />
          <circle cx="11" cy="11" r="3" fill="none" stroke="white" strokeWidth="1.6" />
          <circle cx="15.2" cy="6.8" r=".9" fill="white" />
        </svg>
      );
    case "x":
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <rect width="22" height="22" rx="3" fill="#000" />
          <path fill="white" d="M14.7 5h2.4l-5.2 5.9 6.1 8.1h-4.7L9.5 14l-4.2 5H3l5.5-6.3L2.7 5H7.5l3.3 4.4L14.7 5z" />
        </svg>
      );
    case "google_business_profile":
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <rect width="22" height="22" rx="3" fill="#4584ED" />
          <path fill="white" d="M18.9 10.3h-3.8v1.5h2.2c-.3 1.3-1.4 2.2-2.8 2.2-1.7 0-3-1.4-3-3s1.3-3 3-3c.8 0 1.5.3 2 .8l1.2-1.1c-.9-.9-2-1.4-3.2-1.4-2.5 0-4.6 2-4.6 4.6S11 15.6 13.5 15.6c2.7 0 4.5-1.9 4.5-4.6 0-.2 0-.5-.1-.7z" />
        </svg>
      );
    case "pinterest":
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <circle cx="11" cy="11" r="11" fill="#E60023" />
          <path fill="white" d="M11 4C7.1 4 4 7.1 4 11c0 3.1 1.9 5.7 4.6 6.8-.1-.6-.1-1.5.1-2.2l.8-3.3s-.2-.4-.2-1c0-1 .6-1.7 1.3-1.7.6 0 .9.5.9 1 0 .6-.4 1.5-.6 2.3-.2.7.3 1.3 1 1.3 1.2 0 2-1.2 2-3 0-1.6-1.1-2.7-2.8-2.7-1.9 0-3 1.4-3 2.9 0 .6.2 1.2.5 1.5.1.1.1.2.1.3l-.2.8c0 .1-.1.2-.3.1-1.1-.5-1.8-2-1.8-3.2 0-2.6 1.9-5 5.5-5 2.9 0 5.1 2 5.1 4.8 0 2.9-1.8 5.2-4.4 5.2-.9 0-1.7-.5-2-1l-.5 2c-.2.7-.7 1.6-1 2.1.7.2 1.5.3 2.2.3 3.9 0 7-3.1 7-7S14.9 4 11 4z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
          <rect width="22" height="22" rx="3" fill="#010101" />
          <path fill="white" d="M16.5 6.5a3.5 3.5 0 0 1-3.5-3.5h-2.5v9.5a1.5 1.5 0 1 1-1.5-1.5v-2.5a4 4 0 1 0 4 4V9a6 6 0 0 0 3.5 1.1z" />
        </svg>
      );
  }
}

export function ProfileSelector({ available, selected, onChange, className }: ProfileSelectorProps) {
  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  function deselectAll() {
    onChange([]);
  }

  const hasSelected = selected.length > 0;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {available.map((conn) => {
        const isSelected = selected.includes(conn.id);
        const color = PLATFORM_COLOR[conn.platform];
        return (
          <button
            key={conn.id}
            type="button"
            aria-label={conn.account_name}
            aria-pressed={isSelected}
            onClick={() => toggle(conn.id)}
            className={cn(
              "profile-chip relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all",
              isSelected
                ? "ring-2 ring-offset-1"
                : "opacity-50 hover:opacity-80",
            )}
          >
            <PlatformIcon platform={conn.platform} size={22} />
            {isSelected && (
              <span
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `0 0 0 2px white, 0 0 0 4px ${color}` }}
                aria-hidden
              />
            )}
          </button>
        );
      })}

      {/* "Add profile" chip — links to connection settings */}
      <a
        href="/company/social/connections"
        aria-label="Add profile"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </a>

      {hasSelected && (
        <button
          type="button"
          onClick={deselectAll}
          className="ml-1 text-xs text-muted-foreground hover:text-foreground underline"
        >
          Deselect all
        </button>
      )}
    </div>
  );
}
