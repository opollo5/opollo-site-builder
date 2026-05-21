"use client";

import * as React from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { PostChip } from "./PostChip";
import type { CalendarPost } from "@/lib/social/types";

interface CalendarCellProps {
  date: Date;
  posts: CalendarPost[];
  isSelected: boolean;
  isPast: boolean;
  isOtherMonth: boolean;
  isToday: boolean;
  onAdd: () => void;
  onClick: () => void;
  onClickPost?: (post: CalendarPost) => void;
}

export function CalendarCell({
  date,
  posts,
  isSelected,
  isPast,
  isOtherMonth,
  isToday,
  onAdd,
  onClick,
  onClickPost,
}: CalendarCellProps) {
  const droppableId = date.toISOString().slice(0, 10);
  const canDrop = !isPast && !isOtherMonth;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId, disabled: !canDrop });

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      aria-label={date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
      aria-selected={isSelected}
      onClick={onClick}
      className={cn(
        "group relative flex min-h-[80px] flex-col gap-0.5 rounded border border-border p-1 cursor-pointer transition-colors",
        isOtherMonth && "bg-muted/30 text-muted-foreground",
        isPast && !isOtherMonth && "bg-muted/20",
        isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
        isOver && canDrop && "border-primary/60 bg-primary/10",
        !isOtherMonth && !isPast && !isSelected && "hover:border-primary/40 hover:bg-muted/30",
      )}
      data-testid="calendar-cell"
      data-date={droppableId}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "text-xs font-medium leading-none",
            isToday && "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold",
            !isToday && isOtherMonth && "text-muted-foreground/60",
          )}
        >
          {date.getDate()}
        </span>

        {!isPast && !isOtherMonth && (
          <button
            type="button"
            aria-label="Create post"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            className="hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary group-hover:flex"
            data-testid="cell-add-btn"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex flex-col gap-0.5 overflow-hidden">
        {posts.slice(0, 3).map((post) => (
          <PostChip
            key={post.id}
            post={post}
            onClick={onClickPost ? (e) => { e.stopPropagation(); onClickPost(post); } : undefined}
          />
        ))}
        {posts.length > 3 && (
          <span className="text-xs text-muted-foreground pl-1">+{posts.length - 3} more</span>
        )}
      </div>
    </div>
  );
}
