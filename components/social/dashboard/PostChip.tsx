import * as React from "react";
import { cn } from "@/lib/utils";
import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";
import type { CalendarPost, Platform } from "@/lib/social/types";

interface PostChipProps {
  post: CalendarPost;
  className?: string;
}

function stateIcon(state: CalendarPost["state"]): React.ReactNode {
  if (state === "published") {
    return (
      <svg
        className="post-chip__state ml-auto h-3 w-3 shrink-0 text-emerald-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="published"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (state === "scheduled" || state === "recurring") {
    return (
      <svg
        className="post-chip__state ml-auto h-3 w-3 shrink-0 text-amber-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="scheduled"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (state === "failed") {
    return (
      <svg
        className="post-chip__state ml-auto h-3 w-3 shrink-0 text-destructive"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="failed"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  return null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

export function PostChip({ post, className }: PostChipProps) {
  const primaryProfile = post.target_profiles[0];
  const time = formatTime(post.scheduled_at ?? post.published_at);
  const iconKey = primaryProfile?.platform
    ? (primaryProfile.platform.toUpperCase().replace("GOOGLE_BUSINESS_PROFILE", "GOOGLE_BUSINESS") as SocialPlatformIconKey)
    : null;

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded px-1 py-0.5 text-xs bg-background border border-border hover:bg-muted cursor-pointer transition-colors",
        className,
      )}
      data-testid="post-chip"
    >
      {iconKey && (
        <SocialPlatformIcon
          platform={iconKey}
          size={14}
          className="shrink-0"
        />
      )}
      {time && <span className="text-muted-foreground font-medium">{time}</span>}
      {stateIcon(post.state)}
    </div>
  );
}
