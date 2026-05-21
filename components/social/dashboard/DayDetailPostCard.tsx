"use client";

import * as React from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";
import type { CalendarPost } from "@/lib/social/types";

interface DayDetailPostCardProps {
  post: CalendarPost;
  onDelete: (id: string) => void;
  onReschedule: (id: string) => void;
  onClick: (id: string) => void;
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return "";
  }
}

function stateClass(state: CalendarPost["state"]): string {
  if (state === "published") return "text-emerald-600";
  if (state === "failed") return "text-destructive";
  if (state === "pending_approval") return "text-amber-600";
  return "text-muted-foreground";
}

function StateIcon({ state }: { state: CalendarPost["state"] }) {
  if (state === "published") {
    return (
      <svg className={cn("h-3.5 w-3.5 shrink-0", stateClass(state))} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-label="published">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (state === "scheduled" || state === "recurring") {
    return (
      <svg className={cn("h-3.5 w-3.5 shrink-0", stateClass(state))} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label="scheduled">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (state === "pending_approval") {
    return (
      <svg className={cn("h-3.5 w-3.5 shrink-0", stateClass(state))} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label="pending approval">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </svg>
    );
  }
  if (state === "failed") {
    return (
      <svg className={cn("h-3.5 w-3.5 shrink-0", stateClass(state))} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label="failed">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    );
  }
  return null;
}

export function DayDetailPostCard({ post, onDelete, onReschedule, onClick }: DayDetailPostCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: post.id,
    data: { postId: post.id, scheduledAt: post.scheduled_at },
  });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  const primaryProfile = post.target_profiles[0];
  const iconKey = primaryProfile?.platform
    ? (primaryProfile.platform.toUpperCase().replace("GOOGLE_BUSINESS_PROFILE", "GOOGLE_BUSINESS") as SocialPlatformIconKey)
    : null;
  const time = formatTime(post.scheduled_at ?? post.published_at);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 transition-shadow hover:shadow-sm",
        isDragging && "opacity-50 shadow-lg z-50",
      )}
      data-testid="day-detail-post-card"
      data-post-id={post.id}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label="Drag to reschedule"
        className="mt-0.5 cursor-grab touch-none text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
        {...listeners}
        {...attributes}
        data-testid="drag-handle"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="5" r="1" fill="currentColor" />
          <circle cx="15" cy="5" r="1" fill="currentColor" />
          <circle cx="9" cy="12" r="1" fill="currentColor" />
          <circle cx="15" cy="12" r="1" fill="currentColor" />
          <circle cx="9" cy="19" r="1" fill="currentColor" />
          <circle cx="15" cy="19" r="1" fill="currentColor" />
        </svg>
      </button>

      {/* Platform + time header */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5" onClick={() => onClick(post.id)}>
        <div className="flex items-center gap-1.5">
          {iconKey && <SocialPlatformIcon platform={iconKey} size={16} className="shrink-0" />}
          {time && <span className="text-xs font-medium text-muted-foreground">{time}</span>}
          <StateIcon state={post.state} />
        </div>
        <p className="line-clamp-2 text-sm text-foreground">{post.content_excerpt}</p>
      </div>

      {/* Media thumbnail */}
      {post.primary_media_url && (
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.primary_media_url} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      {/* Hover action buttons */}
      <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex" data-testid="hover-actions">
        <button
          type="button"
          aria-label="Delete"
          onClick={(e) => { e.stopPropagation(); onDelete(post.id); }}
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Reschedule"
          onClick={(e) => { e.stopPropagation(); onReschedule(post.id); }}
          className="flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-primary hover:border-primary transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
