"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// Monthly calendar grid for /company/social/calendar.
//
// The server page pre-fetches entries for the full 6-row grid. This client
// component handles platform filtering (local state) and prev/next month
// navigation (href → full page reload with ?month=YYYY-MM).
// ---------------------------------------------------------------------------

type Entry = {
  id: string;
  post_master_id: string;
  platform: SocialPlatform;
  scheduled_at: string;
  preview: string | null;
};

type Props = {
  entries: Entry[];
  monthIso: string; // "YYYY-MM"
};

const PLATFORMS: SocialPlatform[] = [
  "linkedin_personal",
  "linkedin_company",
  "facebook_page",
  "x",
  "gbp",
];

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CHIP_CLASS: Record<SocialPlatform, string> = {
  linkedin_personal: "bg-blue-500/20 text-blue-300",
  linkedin_company: "bg-blue-500/20 text-blue-300",
  facebook_page: "bg-indigo-500/20 text-indigo-300",
  x: "bg-white/10 text-white/70",
  gbp: "bg-emerald-500/20 text-emerald-300",
};

const PLATFORM_ABBR: Record<SocialPlatform, string> = {
  linkedin_personal: "LI",
  linkedin_company: "LI",
  facebook_page: "FB",
  x: "X",
  gbp: "GBP",
};

function shiftMonth(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function buildGrid(monthIso: string): Date[] {
  const [year, month] = monthIso.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const startDow = (firstDay.getDay() + 6) % 7; // Mon=0 … Sun=6
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - startDow);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function localDayKey(d: Date): string {
  // Use local date components to group entries correctly per timezone.
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SocialCalendarClient({ entries, monthIso }: Props) {
  const [filter, setFilter] = useState<SocialPlatform | "all">("all");

  const [year, month] = monthIso.split("-").map(Number);
  const prevMonth = shiftMonth(monthIso, -1);
  const nextMonth = shiftMonth(monthIso, +1);

  const todayKey = localDayKey(new Date());
  const currentMonthIso = (() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  })();
  const isCurrentMonth = monthIso === currentMonthIso;

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
  });

  const grid = useMemo(() => buildGrid(monthIso), [monthIso]);

  const entryMap = useMemo(() => {
    const map = new Map<string, Entry[]>();
    const visible = filter === "all" ? entries : entries.filter((e) => e.platform === filter);
    for (const e of visible) {
      const key = localDayKey(new Date(e.scheduled_at));
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [entries, filter]);

  return (
    <div data-testid="social-calendar">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <a
            href={`?month=${prevMonth}`}
            aria-label="Previous month"
            data-testid="calendar-prev"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm hover:bg-muted"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </a>
          <span
            className="min-w-[10rem] text-center text-sm font-semibold"
            data-testid="calendar-month-label"
          >
            {monthLabel}
          </span>
          <a
            href={`?month=${nextMonth}`}
            aria-label="Next month"
            data-testid="calendar-next"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm hover:bg-muted"
          >
            <ChevronRight aria-hidden className="h-4 w-4" />
          </a>
          {!isCurrentMonth && (
            <a
              href="/company/social/calendar"
              className="ml-2 rounded-md border px-3 py-1 text-sm hover:bg-muted"
              data-testid="calendar-today"
            >
              Today
            </a>
          )}
        </div>

        {/* Platform filter */}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as SocialPlatform | "all")}
          data-testid="calendar-filter"
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABEL[p]}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      <div
        className="overflow-hidden rounded-lg border border-white/[0.06]"
        role="grid"
        aria-label={`Calendar for ${monthLabel}`}
      >
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 border-b border-white/[0.06] bg-white/[0.04]" role="row">
          {DAY_HEADERS.map((d) => (
            <div
              key={d}
              role="columnheader"
              className="px-2 py-1.5 text-center text-xs font-medium uppercase tracking-wide text-m3"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells — 6 rows */}
        <div className="grid grid-cols-7">
          {grid.map((day, idx) => {
            const dayKey = localDayKey(day);
            const inMonth = day.getMonth() === month - 1;
            const isToday = dayKey === todayKey;
            const dayEntries = entryMap.get(dayKey) ?? [];
            const isLastRow = idx >= 35;
            const isLastCol = idx % 7 === 6;

            return (
              <div
                key={dayKey}
                role="gridcell"
                data-testid={`calendar-day-${dayKey}`}
                className={[
                  "min-h-[6rem] p-1.5",
                  !isLastRow && "border-b border-white/[0.06]",
                  !isLastCol && "border-r border-white/[0.06]",
                  !inMonth && "opacity-30",
                ].filter(Boolean).join(" ")}
              >
                {/* Date number */}
                <div className="flex justify-end">
                  <span
                    className={[
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      isToday
                        ? "bg-pk text-white"
                        : "text-m2",
                    ].join(" ")}
                  >
                    {day.getDate()}
                  </span>
                </div>

                {/* Post chips */}
                <ul className="mt-1 space-y-0.5">
                  {dayEntries.map((e) => (
                    <li key={e.id}>
                      <a
                        href={`/company/social/posts/${e.post_master_id}`}
                        data-testid={`calendar-entry-${e.id}`}
                        className={[
                          "flex items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight truncate hover:opacity-80 transition-opacity",
                          CHIP_CLASS[e.platform],
                        ].join(" ")}
                        title={e.preview ?? "(no copy)"}
                      >
                        <span className="shrink-0 font-semibold">
                          {PLATFORM_ABBR[e.platform]}
                        </span>
                        <span className="shrink-0 opacity-70">
                          {timeLabel(e.scheduled_at)}
                        </span>
                        {e.preview && (
                          <span className="truncate opacity-80">
                            {e.preview}
                          </span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Total count */}
      {entries.length > 0 && (
        <p className="mt-3 text-right text-xs text-m3" data-testid="calendar-count">
          {entries.length} {entries.length === 1 ? "post" : "posts"} this month
        </p>
      )}
    </div>
  );
}
