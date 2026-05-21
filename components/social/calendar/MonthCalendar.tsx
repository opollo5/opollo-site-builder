"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { DayCell } from "./DayCell";
import { useCalendarView } from "@/hooks/use-calendar-view";

// ---------------------------------------------------------------------------
// MonthCalendar — PR-C2
//
// Richer replacement for MiniCalendar in the ComposerOverlay right-pane
// "Calendar" tab. Fetches scheduled/published posts via useCalendarView and
// renders them as PostChip items in each day cell.
//
// Props:
//   companyId    — required for the calendar-view API call
//   selectedDate — date currently targeted by the composer scheduling card
//   onDateSelect — called when the user clicks a day
//   className    — optional wrapper class
// ---------------------------------------------------------------------------

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April",
  "May", "June", "July", "August",
  "September", "October", "November", "December",
];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Monday-first 7-column grid (mirrors CalendarShell)
function buildGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  const firstDow = (first.getDay() + 6) % 7;
  const lastDow = (last.getDay() + 6) % 7;

  const cells: Date[] = [];

  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push(new Date(year, month, -i));
  }
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(new Date(year, month, d));
  }
  const trailing = lastDow < 6 ? 6 - lastDow : 0;
  for (let d = 1; d <= trailing; d++) {
    cells.push(new Date(year, month + 1, d));
  }

  return cells;
}

function isSameDay(a: Date, b: Date) {
  return isoDate(a) === isoDate(b);
}

export interface MonthCalendarProps {
  companyId: string;
  selectedDate?: Date;
  onDateSelect?: (date: Date) => void;
  className?: string;
}

export function MonthCalendar({
  companyId,
  selectedDate,
  onDateSelect,
  className,
}: MonthCalendarProps) {
  const today = new Date();
  const [viewYear, setViewYear] = React.useState(
    selectedDate?.getFullYear() ?? today.getFullYear(),
  );
  const [viewMonth, setViewMonth] = React.useState(
    selectedDate?.getMonth() ?? today.getMonth(),
  );

  const from = isoDate(new Date(viewYear, viewMonth, 1));
  const to = isoDate(new Date(viewYear, viewMonth + 1, 0));

  const { posts, isLoading } = useCalendarView(companyId, from, to);

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
    <div
      className={cn("select-none rounded-xl border border-border bg-white p-3", className)}
      data-testid="month-calendar"
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={prevMonth}
          aria-label="Previous month"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>

        <p className="flex items-center gap-2 text-sm font-semibold">
          {MONTH_NAMES[viewMonth]} {viewYear}
          {isLoading && (
            <span
              className="inline-block h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin"
              aria-label="Loading"
            />
          )}
        </p>

        <button
          type="button"
          onClick={nextMonth}
          aria-label="Next month"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </div>

      {/* Day-of-week labels */}
      <div
        className="mb-1 grid grid-cols-7 gap-0.5"
        role="row"
        aria-label="Days of the week"
      >
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5" role="grid" aria-label="Calendar">
        {cells.map((date) => {
          const key = isoDate(date);
          const dayPosts = posts.filter((p) => {
            const at = p.scheduled_at ?? p.published_at;
            return at ? at.slice(0, 10) === key : false;
          });
          const isCurrentMonth = date.getMonth() === viewMonth;

          return (
            <DayCell
              key={key}
              date={date}
              posts={dayPosts}
              isSelected={selectedDate ? isSameDay(date, selectedDate) : false}
              isToday={isSameDay(date, today)}
              isPast={date < today && !isSameDay(date, today)}
              isOtherMonth={!isCurrentMonth}
              onClick={(d) => onDateSelect?.(d)}
            />
          );
        })}
      </div>
    </div>
  );
}
