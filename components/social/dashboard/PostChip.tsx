import * as React from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";
import type { CalendarPost } from "@/lib/social/types";

interface PostChipProps {
  post: CalendarPost;
  className?: string;
  highlighted?: boolean;
  onClick?: (e: React.MouseEvent) => void;
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

export function PostChip({ post, className, highlighted = false, onClick }: PostChipProps) {
  const primaryProfile = post.target_profiles[0];
  const time = formatTime(post.scheduled_at ?? post.published_at);
  const iconKey = primaryProfile?.platform
    ? (primaryProfile.platform.toUpperCase().replace("GOOGLE_BUSINESS_PROFILE", "GOOGLE_BUSINESS") as SocialPlatformIconKey)
    : null;

  const hasLink = !post.primary_media_url && post.link_url !== null;

  return (
    // D3: larger/higher-contrast entries — taller chip, excerpt, thumbnail.
    <div
      className={cn(
        "flex items-start gap-1.5 rounded px-1.5 py-1 text-xs bg-background border border-border hover:bg-muted cursor-pointer transition-colors overflow-hidden",
        highlighted && "ring-2 ring-emerald-500",
        className,
      )}
      data-testid="post-chip"
      onClick={onClick}
    >
      {/* Left: icon + time + state + excerpt */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1">
          {/* Brand-colour platform icon (D3) */}
          {iconKey && (
            <SocialPlatformIcon platform={iconKey} size={14} className="shrink-0" />
          )}
          {time && (
            <span className="truncate font-medium text-foreground">{time}</span>
          )}
          {hasLink && <Link2 size={10} className="shrink-0 text-muted-foreground" aria-label="has link" />}
          {stateIcon(post.state)}
        </div>
        {post.content_excerpt && (
          <p className="line-clamp-1 text-xs leading-tight text-foreground/70">
            {post.content_excerpt}
          </p>
        )}
      </div>

      {/* Right: thumbnail — reuse primary_media_url (D3) */}
      {post.primary_media_url && (
        <div className="h-8 w-8 shrink-0 overflow-hidden rounded border border-border" aria-label="has media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.primary_media_url}
            alt=""
            className="h-full w-full object-cover"
            data-testid="post-chip-thumbnail"
          />
        </div>
      )}
    </div>
  );
}
