"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// MiniCalendar — compact month grid shown in the composer right-pane
// "Calendar" tab. Highlights dates that have scheduled posts.
// ---------------------------------------------------------------------------

export interface MiniCalendarProps {
  /** Currently selected / targeted date. */
  selectedDate?: Date;
  /** Dates with scheduled posts. */
  scheduledDates?: Date[];
  onDateSelect?: (date: Date) => void;
  className?: string;
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildGrid(year: number, month: number): Array<Date | null> {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: firstDay }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function MiniCalendar({
  selectedDate,
  scheduledDates = [],
  onDateSelect,
  className,
}: MiniCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = React.useState(
    selectedDate?.getFullYear() ?? today.getFullYear(),
  );
  const [viewMonth, setViewMonth] = React.useState(
    selectedDate?.getMonth() ?? today.getMonth(),
  );

  const cells = buildGrid(viewYear, viewMonth);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  return (
    <div className={cn("select-none rounded-xl border border-border bg-white p-4", className)}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <p className="text-sm font-semibold">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </p>
        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Date cells */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} />;
          }
          const isToday = isSameDay(date, today);
          const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
          const hasPost = scheduledDates.some((d) => isSameDay(d, date));
          const isPast = date < today && !isToday;

          return (
            <button
              key={date.toISOString()}
              type="button"
              onClick={() => onDateSelect?.(date)}
              aria-label={date.toLocaleDateString("en-AU", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              className={cn(
                "relative flex h-7 w-full items-center justify-center rounded text-xs transition-colors",
                isSelected
                  ? "bg-primary text-primary-foreground font-semibold"
                  : isToday
                  ? "border border-primary text-primary font-semibold"
                  : isPast
                  ? "text-muted-foreground/50"
                  : "hover:bg-muted",
              )}
            >
              {date.getDate()}
              {hasPost && !isSelected && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-primary"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
