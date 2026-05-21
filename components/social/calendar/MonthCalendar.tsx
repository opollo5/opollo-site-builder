"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { DayCell } from "./DayCell";
import { useCalendarView } from "@/hooks/use-calendar-view";
import type { CalendarPost } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// MonthCalendar — unified calendar grid for both page and composer-pane.
//
// Page context  : controlled navigation via `year`/`month`/`onNavigate`;
//                 `showTodayButton`; `profileFilter`; `renderDay` lets the
//                 caller swap in DnD-aware CalendarCell while keeping grid
//                 layout, data-fetching, and testids here.
// Composer-pane : self-contained; all props optional; default DayCell render.
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
  for (let i = firstDow - 1; i >= 0; i--) cells.push(new Date(year, month, -i));
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(year, month, d));
  const trailing = lastDow < 6 ? 6 - lastDow : 0;
  for (let d = 1; d <= trailing; d++) cells.push(new Date(year, month + 1, d));
  return cells;
}

function isSameDay(a: Date, b: Date) {
  return isoDate(a) === isoDate(b);
}

export interface DayCellMeta {
  isSelected: boolean;
  isToday: boolean;
  isPast: boolean;
  isOtherMonth: boolean;
}

export interface MonthCalendarProps {
  companyId: string;
  selectedDate?: Date;
  onDateSelect?: (date: Date) => void;
  onClickPost?: (post: CalendarPost) => void;
  highlightPostId?: string;
  context?: "page" | "composer-pane";
  className?: string;
  /** Controlled year (overrides internal state) */
  year?: number;
  /** Controlled month 0–11 (overrides internal state) */
  month?: number;
  /** Called when Prev / Next / Today navigation is triggered */
  onNavigate?: (year: number, month: number) => void;
  /** Render a "Today" button in the header (page context) */
  showTodayButton?: boolean;
  /** Profile IDs to pass to useCalendarView */
  profileFilter?: string[];
  /**
   * Custom day-cell renderer. When provided, replaces the default DayCell.
   * The caller is responsible for DnD wiring; MonthCalendar handles the grid
   * loop, data fetching, and key reconciliation.
   */
  renderDay?: (date: Date, posts: CalendarPost[], meta: DayCellMeta) => React.ReactNode;
}

export function MonthCalendar({
  companyId,
  selectedDate,
  onDateSelect,
  onClickPost,
  highlightPostId,
  context = "composer-pane",
  className,
  year: yearProp,
  month: monthProp,
  onNavigate,
  showTodayButton,
  profileFilter,
  renderDay,
}: MonthCalendarProps) {
  const today = new Date();

  const [localYear, setLocalYear] = React.useState(
    yearProp ?? selectedDate?.getFullYear() ?? today.getFullYear(),
  );
  const [localMonth, setLocalMonth] = React.useState(
    monthProp ?? selectedDate?.getMonth() ?? today.getMonth(),
  );

  // Sync local state when controlled props change
  React.useEffect(() => {
    if (yearProp !== undefined) setLocalYear(yearProp);
  }, [yearProp]);
  React.useEffect(() => {
    if (monthProp !== undefined) setLocalMonth(monthProp);
  }, [monthProp]);

  const viewYear = yearProp ?? localYear;
  const viewMonth = monthProp ?? localMonth;

  const from = isoDate(new Date(viewYear, viewMonth, 1));
  const to = isoDate(new Date(viewYear, viewMonth + 1, 0));

  const { posts, isLoading } = useCalendarView(companyId, from, to, profileFilter ?? []);

  const cells = buildGrid(viewYear, viewMonth);

  function navigate(y: number, m: number) {
    if (onNavigate) {
      onNavigate(y, m);
    } else {
      setLocalYear(y);
      setLocalMonth(m);
    }
  }

  function prevMonth() {
    const y = viewMonth === 0 ? viewYear - 1 : viewYear;
    const m = viewMonth === 0 ? 11 : viewMonth - 1;
    navigate(y, m);
  }

  function nextMonth() {
    const y = viewMonth === 11 ? viewYear + 1 : viewYear;
    const m = viewMonth === 11 ? 0 : viewMonth + 1;
    navigate(y, m);
  }

  const isPage = context === "page";

  return (
    <div
      className={cn(
        "select-none",
        isPage
          ? "flex flex-1 flex-col"
          : "rounded-xl border border-border bg-white p-3",
        className,
      )}
      data-testid="month-calendar"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {isPage ? (
        <div className="mb-3 flex items-center gap-1" role="toolbar" aria-label="Month navigation">
          <h2 className="text-base font-semibold text-foreground" data-testid="month-label">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </h2>
          <button
            type="button"
            aria-label="Previous month"
            onClick={prevMonth}
            className="ml-2 flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={nextMonth}
            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
          </button>
          {showTodayButton && (
            <button
              type="button"
              onClick={() => navigate(today.getFullYear(), today.getMonth())}
              className="ml-1 rounded px-2 py-0.5 text-sm text-muted-foreground hover:bg-muted"
            >
              Today
            </button>
          )}
          {isLoading && (
            <span className="ml-2 text-xs text-muted-foreground animate-pulse">Loading…</span>
          )}
        </div>
      ) : (
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

          <p className="flex items-center gap-2 text-sm font-semibold" data-testid="month-label">
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Day-of-week labels ──────────────────────────────────────────────── */}
      <div
        className={cn(
          "mb-1 grid grid-cols-7 text-xs font-medium text-muted-foreground",
          isPage ? "gap-1" : "gap-0.5",
        )}
        role="row"
        aria-label="Days of the week"
      >
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className={cn(
              "text-center",
              isPage ? "px-1 py-0.5" : "uppercase tracking-wide",
            )}
            role="columnheader"
          >
            {d}
          </div>
        ))}
      </div>

      {/* ── Day cells ──────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "grid grid-cols-7",
          isPage ? "flex-1 gap-1" : "gap-0.5",
        )}
        role="grid"
        aria-label={`Calendar for ${MONTH_NAMES[viewMonth]} ${viewYear}`}
        data-testid="calendar-grid"
      >
        {cells.map((date) => {
          const key = isoDate(date);
          const dayPosts = posts.filter((p) => {
            const at = p.scheduled_at ?? p.published_at;
            return at ? at.slice(0, 10) === key : false;
          });
          const isCurrentMonth = date.getMonth() === viewMonth;
          const todayFlag = isSameDay(date, today);
          const isPast = date < today && !todayFlag;
          const isOtherMonth = !isCurrentMonth;
          const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;

          if (renderDay) {
            return (
              <React.Fragment key={key}>
                {renderDay(date, dayPosts, {
                  isSelected,
                  isToday: todayFlag,
                  isPast,
                  isOtherMonth,
                })}
              </React.Fragment>
            );
          }

          return (
            <DayCell
              key={key}
              date={date}
              posts={dayPosts}
              isSelected={isSelected}
              isToday={todayFlag}
              isPast={isPast}
              isOtherMonth={isOtherMonth}
              onClick={(d) => onDateSelect?.(d)}
              highlightPostId={highlightPostId}
              onClickPost={onClickPost}
            />
          );
        })}
      </div>
    </div>
  );
}
