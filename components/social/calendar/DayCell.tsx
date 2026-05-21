"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PostChip } from "@/components/social/dashboard/PostChip";
import type { CalendarPost } from "@/lib/social/types";

interface DayCellProps {
  date: Date;
  posts: CalendarPost[];
  isSelected: boolean;
  isToday: boolean;
  isPast: boolean;
  isOtherMonth: boolean;
  onClick: (date: Date) => void;
  highlightPostId?: string;
  onClickPost?: (post: CalendarPost) => void;
}

const MAX_VISIBLE = 3;

export function DayCell({
  date,
  posts,
  isSelected,
  isToday,
  isPast,
  isOtherMonth,
  onClick,
  highlightPostId,
  onClickPost,
}: DayCellProps) {
  const overflow = posts.length - MAX_VISIBLE;
  const hasCellHighlight = highlightPostId ? posts.some((p) => p.id === highlightPostId) : false;

  return (
    <div
      role="gridcell"
      aria-label={date.toLocaleDateString("en-AU", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}
      aria-selected={isSelected}
      onClick={() => onClick(date)}
      data-testid={`calendar-day-${date.toISOString().slice(0, 10)}`}
      className={cn(
        "relative flex min-h-[80px] flex-col gap-0.5 rounded border border-border p-1 cursor-pointer transition-colors",
        isOtherMonth && "bg-muted/30 text-muted-foreground",
        isPast && !isOtherMonth && "bg-muted/20",
        isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
        !isOtherMonth && !isPast && !isSelected && "hover:border-primary/40 hover:bg-muted/30",
        hasCellHighlight && !isSelected && "border-2 border-emerald-500 bg-emerald-50/60",
      )}
    >
      <span
        className={cn(
          "text-xs font-medium leading-none",
          isToday &&
            "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold",
          !isToday && isOtherMonth && "text-muted-foreground/60",
        )}
      >
        {date.getDate()}
      </span>

      <div className="flex flex-col gap-0.5 overflow-hidden">
        {posts.slice(0, MAX_VISIBLE).map((post) => (
          <PostChip
            key={post.id}
            post={post}
            highlighted={post.id === highlightPostId}
            onClick={onClickPost ? (e) => { e.stopPropagation(); onClickPost(post); } : undefined}
          />
        ))}
        {overflow > 0 && (
          <span className="pl-1 text-xs text-muted-foreground">+{overflow} more</span>
        )}
      </div>
    </div>
  );
}
