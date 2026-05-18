"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// CustomizeForRow — platform-variant chip strip.
// Shown when ≥2 platforms are selected. Clicking a chip activates it so
// ContentEditor shows that platform's variant copy (falls back to main copy).
// Clicking the active chip deactivates it (back to "All platforms" mode).
// ---------------------------------------------------------------------------

export interface CustomizeForRowProps {
  platforms: Platform[];
  activePlatform: Platform | null;
  onChange: (p: Platform | null) => void;
  className?: string;
}

const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  google_business_profile: "GBP",
  pinterest: "Pinterest",
  tiktok: "TikTok",
};

const PLATFORM_COLOR: Record<Platform, string> = {
  linkedin: "#0A66C2",
  facebook: "#1877F2",
  instagram: "#DD2A7B",
  x: "#000000",
  google_business_profile: "#4584ED",
  pinterest: "#E60023",
  tiktok: "#010101",
};

export function CustomizeForRow({
  platforms,
  activePlatform,
  onChange,
  className,
}: CustomizeForRowProps) {
  if (platforms.length < 2) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="text-xs text-muted-foreground font-medium">Customize for</span>
      <div className="flex flex-wrap gap-1.5">
        {platforms.map((platform) => {
          const isActive = activePlatform === platform;
          const color = PLATFORM_COLOR[platform];
          return (
            <button
              key={platform}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(isActive ? null : platform)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                isActive
                  ? "border-transparent text-white"
                  : "border-border bg-background text-muted-foreground hover:border-muted-foreground",
              )}
              style={isActive ? { backgroundColor: color } : undefined}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: isActive ? "white" : color }}
                aria-hidden
              />
              {PLATFORM_LABEL[platform]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
