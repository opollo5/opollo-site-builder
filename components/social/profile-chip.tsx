"use client";

import * as React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Platform } from "@/lib/social/types";
import {
  LinkedInIcon,
  FacebookIcon,
  InstagramIcon,
  XIcon,
  GoogleBusinessIcon,
  PinterestIcon,
  TikTokIcon,
} from "@/components/icons/social";

// ---------------------------------------------------------------------------
// ProfileChip — 56px circular avatar chip with platform brand icon badge.
//
// Layout:
//  - 56px outer circle, 2px border (3px + emerald when selected)
//  - 52px avatar (account_avatar_url or letter fallback)
//  - 20px checkbox overlay top-left
//  - 24px platform icon overlay bottom-right with 2.5px white ring
//
// States: default | selected | hovered | disconnected
// ---------------------------------------------------------------------------

export interface ProfileChipProps {
  id: string;
  name: string;
  platform: Platform;
  avatarUrl?: string | null;
  selected: boolean;
  disconnected?: boolean;
  onClick: () => void;
  className?: string;
}

// Brand colours for letter avatar bg + icon badge bg.
const PLATFORM_BG: Record<Platform, string> = {
  linkedin: "#0A66C2",
  facebook: "#1877F2",
  instagram: "#DD2A7B",
  x: "#000000",
  google_business_profile: "#4584ED",
  pinterest: "#E60023",
  tiktok: "#010101",
};

function PlatformBadge({ platform, size = 24 }: { platform: Platform; size?: number }) {
  const props = { size, className: "block" };
  switch (platform) {
    case "linkedin":            return <LinkedInIcon {...props} />;
    case "facebook":            return <FacebookIcon {...props} />;
    case "instagram":           return <InstagramIcon {...props} />;
    case "x":                   return <XIcon {...props} />;
    case "google_business_profile": return <GoogleBusinessIcon {...props} />;
    case "pinterest":           return <PinterestIcon {...props} />;
    case "tiktok":              return <TikTokIcon {...props} />;
  }
}

export function ProfileChip({
  id,
  name,
  platform,
  avatarUrl,
  selected,
  disconnected = false,
  onClick,
  className,
}: ProfileChipProps) {
  const initials = name.trim().slice(0, 2).toUpperCase() || "??";
  const bg = PLATFORM_BG[platform] ?? "#888";
  const dataid = id.replace(/[^a-z0-9]/gi, "-");

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Post to ${name} on ${platform}`}
      aria-disabled={disconnected}
      data-testid={`profile-chip-${dataid}`}
      onClick={disconnected ? undefined : onClick}
      className={cn(
        // Base 56px circle
        "relative inline-flex h-14 w-14 shrink-0 rounded-full",
        "transition-transform duration-[120ms] ease-out",
        // Hover lift (skip when disconnected)
        !disconnected && "hover:-translate-y-px",
        // Border — 3px selected, 2px default
        selected
          ? "ring-[3px] ring-emerald-500 ring-offset-1"
          : "ring-2 ring-border ring-offset-0",
        // Disconnected appearance
        disconnected && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {/* Avatar — 52px inset */}
      <span className="absolute inset-0.5 rounded-full overflow-hidden">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center text-xs font-semibold text-white"
            style={{ background: bg }}
          >
            {initials}
          </span>
        )}
      </span>

      {/* Checkbox overlay — top-left, 20px */}
      <span
        className={cn(
          "absolute -left-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white transition-colors duration-[60ms]",
          selected ? "bg-emerald-500" : "bg-white/90",
        )}
        aria-hidden
      >
        {disconnected ? (
          <AlertTriangle size={10} strokeWidth={2.5} className="text-amber-500" />
        ) : selected ? (
          <Check size={10} strokeWidth={3} className="text-white" />
        ) : null}
      </span>

      {/* Platform icon badge — bottom-right, 24px with 2.5px white ring */}
      <span
        className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-0.5"
        aria-hidden
      >
        <PlatformBadge platform={platform} size={16} />
      </span>
    </button>
  );
}
