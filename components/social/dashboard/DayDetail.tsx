"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { DayDetailPostCard } from "./DayDetailPostCard";
import type { CalendarPost } from "@/lib/social/types";

interface DayDetailProps {
  date: Date | null;
  posts: CalendarPost[];
  onPostClick: (id: string) => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string) => void;
  onAddPost: () => void;
  className?: string;
}

export function DayDetail({
  date,
  posts,
  onPostClick,
  onDelete,
  onReschedule,
  onAddPost,
  className,
}: DayDetailProps) {
  if (!date) return null;

  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <aside
      className={cn("flex flex-col gap-3 border-l border-border bg-background p-4", className)}
      aria-label={`Posts for ${dateLabel}`}
      data-testid="day-detail"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{dateLabel}</h3>
        <button
          type="button"
          aria-label="Create post"
          onClick={onAddPost}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      {posts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <p className="text-xs text-muted-foreground">No posts scheduled.</p>
          <button
            type="button"
            onClick={onAddPost}
            className="text-xs text-primary underline-offset-2 hover:underline"
          >
            Add one
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto" data-testid="day-detail-list">
          {posts.map((post) => (
            <DayDetailPostCard
              key={post.id}
              post={post}
              onDelete={onDelete}
              onReschedule={onReschedule}
              onClick={onPostClick}
            />
          ))}
        </div>
      )}
    </aside>
  );
}
