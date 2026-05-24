"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { PostChip } from "@/components/social/dashboard/PostChip";
import { useCalendarView } from "@/hooks/use-calendar-view";
import type { CalendarPost } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// SocialCalendarGrid — unified calendar grid for both page and composer-pane.
//
// Consolidates MonthCalendar + DayCell into a single file.
//
// Page context  : controlled navigation via `year`/`month`/`onNavigate`;
//                 `showTodayButton`; `profileFilter`; `renderDay` lets the
//                 caller swap in DnD-aware cells while keeping grid layout,
//                 data-fetching, and testids here.
// Composer-pane : self-contained; all props optional; default DefaultCell render.
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

// Monday-first 7-column grid
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

export interface SocialCalendarGridProps {
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
  /** Render a "Today" button in the header */
  showTodayButton?: boolean;
  /** Profile IDs to pass to useCalendarView */
  profileFilter?: string[];
  /**
   * Custom day-cell renderer. When provided, replaces the default cell.
   * The caller is responsible for DnD wiring; SocialCalendarGrid handles the
   * grid loop, data fetching, and key reconciliation.
   */
  renderDay?: (date: Date, posts: CalendarPost[], meta: DayCellMeta) => React.ReactNode;
}

// ---------------------------------------------------------------------------
// DefaultCell — standard (non-DnD) day cell
// Issue 3: p-2 padding (was p-1) so today pill has breathing room
// Issue 4: bg-primary/5 tint on today's cell
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 3;

interface DefaultCellProps {
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

function DefaultCell({
  date,
  posts,
  isSelected,
  isToday,
  isPast,
  isOtherMonth,
  onClick,
  highlightPostId,
  onClickPost,
}: DefaultCellProps) {
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
        "relative flex min-h-[80px] flex-col gap-0.5 rounded border border-border p-2 cursor-pointer transition-colors",
        isOtherMonth && "bg-muted/30 text-muted-foreground",
        isPast && !isOtherMonth && "bg-muted/20",
        isToday && !isOtherMonth && !isSelected && "bg-primary/5",
        isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
        !isOtherMonth && !isPast && !isSelected && "hover:border-primary/40 hover:bg-muted/30",
        hasCellHighlight && !isSelected && "border-2 border-emerald-500 bg-[--color-success-bg]",
      )}
    >
      <span
        className={cn(
          "text-xs font-medium leading-none",
          isToday &&
            "flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold",
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

// ---------------------------------------------------------------------------
// SocialCalendarGrid — main export
// ---------------------------------------------------------------------------

export function SocialCalendarGrid({
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
}: SocialCalendarGridProps) {
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

  const isPage = context === "page";

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

  return (
    <div
      className={cn(
        "select-none",
        isPage
          ? "flex flex-1 flex-col"
          : "rounded-xl border border-border bg-white p-3",
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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

      {/* ── Day-of-week labels ──────────────────────────────────────────────── */}
      <div
        className="mb-1 grid grid-cols-7 gap-1 text-xs font-medium text-muted-foreground"
        role="row"
        aria-label="Days of the week"
      >
        {DAY_LABELS.map((d) => (
          <div key={d} className="px-1 py-0.5 text-center" role="columnheader">
            {d}
          </div>
        ))}
      </div>

      {/* ── Day cells ──────────────────────────────────────────────────────── */}
      <div
        className={cn("grid grid-cols-7 gap-1", isPage && "flex-1")}
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
            <DefaultCell
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
