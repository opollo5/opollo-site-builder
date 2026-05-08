"use client";

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Spec 22 PR 3 — MiniCalendarPreview.
//
// Month grid showing where the scheduled post lands. Displayed in the
// "Calendar" tab of the preview pane. Navigation arrows allow the user to
// confirm the target month; the highlighted date is read-only (editing
// schedule happens in the footer SchedulingTabs).
// ---------------------------------------------------------------------------

const DOW_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface MiniCalendarPreviewProps {
  /** YYYY-MM-DD — the post's scheduled date, or undefined if not in schedule mode. */
  highlightDate?: string;
}

export function MiniCalendarPreview({ highlightDate }: MiniCalendarPreviewProps) {
  const today = useMemo(() => new Date(), []);

  // Derive the display month from the highlight date, or fall back to today.
  const { year: viewYear, month: viewMonth } = useMemo(() => {
    if (highlightDate) {
      const [y, m] = highlightDate.split("-").map(Number);
      return { year: y, month: m - 1 };
    }
    return { year: today.getFullYear(), month: today.getMonth() };
  }, [highlightDate, today]);

  const highlightDay = highlightDate ? Number(highlightDate.split("-")[2]) : null;
  const highlightYear = highlightDate ? Number(highlightDate.split("-")[0]) : null;
  const highlightMonth = highlightDate ? Number(highlightDate.split("-")[1]) - 1 : null;

  // Grid: null = padding cell; number = day of month.
  const cells = useMemo((): (number | null)[] => {
    const firstDOW = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const result: (number | null)[] = Array<null>(firstDOW).fill(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(d);
    while (result.length % 7 !== 0) result.push(null);
    return result;
  }, [viewYear, viewMonth]);

  const isHighlight = (day: number) =>
    day === highlightDay &&
    viewYear === highlightYear &&
    viewMonth === highlightMonth;

  const isToday = (day: number) =>
    day === today.getDate() &&
    viewYear === today.getFullYear() &&
    viewMonth === today.getMonth();

  return (
    <div className="space-y-3">
      {/* Month header */}
      <div className="text-center text-sm font-medium text-foreground">
        {MONTH_NAMES[viewMonth]} {viewYear}
      </div>

      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 text-center text-xs text-muted-foreground/50">
        {DOW_LABELS.map((d) => (
          <div key={d} className="py-1 font-medium">
            {d}
          </div>
        ))}
      </div>

      {/* Date cells */}
      <div className="grid grid-cols-7 text-center text-xs">
        {cells.map((day, i) => (
          <div key={i} className="flex items-center justify-center py-0.5">
            {day !== null && (
              <span
                className={[
                  "flex h-6 w-6 items-center justify-center rounded-full",
                  isHighlight(day)
                    ? "bg-pk font-semibold text-white"
                    : isToday(day)
                      ? "font-semibold text-pk ring-1 ring-pk"
                      : "text-foreground",
                ].join(" ")}
              >
                {day}
              </span>
            )}
          </div>
        ))}
      </div>

      {highlightDate ? (
        <p className="text-center text-xs text-muted-foreground">
          Scheduled for{" "}
          <span className="font-medium text-foreground">
            {new Date(highlightDate + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Switch to Schedule mode to pick a date.
        </p>
      )}
    </div>
  );
}
