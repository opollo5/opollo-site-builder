"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  List,
  Plus,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// Monthly calendar grid for /company/social/calendar.
//
// The server page pre-fetches entries for the full 6-row grid plus
// connections for the profiles filter. This client component handles
// platform filtering (local state) and prev/next month navigation
// (href → full page reload with ?month=YYYY-MM).
// ---------------------------------------------------------------------------

type Entry = {
  id: string;
  post_master_id: string;
  platform: SocialPlatform;
  scheduled_at: string;
  preview: string | null;
};

type Connection = {
  id: string;
  platform: SocialPlatform;
  display_name: string | null;
};

type Props = {
  entries: Entry[];
  monthIso: string; // "YYYY-MM"
  connections: Connection[];
  companyName: string;
};

const MAX_CHIPS = 3;

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
  linkedin_company: "LI·P",
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

// -- DayOverflowPopover -------------------------------------------------------

function DayOverflowPopover({
  dayKey,
  dayEntries,
}: {
  dayKey: string;
  dayEntries: Entry[];
}) {
  const [open, setOpen] = useState(false);
  const overflowCount = dayEntries.length - MAX_CHIPS;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="mt-0.5 w-full rounded px-1 py-0.5 text-left text-xs text-m3 transition-colors hover:bg-white/[0.05] hover:text-white"
          data-testid={`calendar-overflow-${dayKey}`}
        >
          +{overflowCount} more
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" side="right" align="start">
        <p className="mb-2 px-1 text-xs font-medium text-m3">
          All posts — {dayKey}
        </p>
        <ul className="space-y-1">
          {dayEntries.map((e) => (
            <li key={e.id}>
              <a
                href={`/company/social/posts/${e.post_master_id}`}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-opacity hover:opacity-80",
                  CHIP_CLASS[e.platform],
                )}
              >
                <span className="shrink-0 font-semibold">
                  {PLATFORM_ABBR[e.platform]}
                </span>
                <span className="shrink-0 opacity-70">
                  {timeLabel(e.scheduled_at)}
                </span>
                {e.preview && (
                  <span className="truncate opacity-80">{e.preview}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// -- ProfilesFilter -----------------------------------------------------------

function ProfilesFilter({
  connections,
  hiddenPlatforms,
  onToggle,
  onShowAll,
}: {
  connections: Connection[];
  hiddenPlatforms: Set<SocialPlatform>;
  onToggle: (platform: SocialPlatform) => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const allVisible = hiddenPlatforms.size === 0;
  const visibleCount = connections.filter(
    (c) => !hiddenPlatforms.has(c.platform),
  ).length;
  const label = allVisible
    ? "All profiles"
    : `${visibleCount} of ${connections.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Filter by profiles"
          className="flex items-center gap-2 rounded-md border border-white/[0.1] px-3 py-1.5 text-sm text-m2 transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          {label}
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="end">
        <div className="space-y-0.5">
          <button
            onClick={onShowAll}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
          >
            <div
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                allVisible ? "border-pk bg-pk" : "border-white/20",
              )}
            >
              {allVisible && (
                <Check className="h-3 w-3 text-white" aria-hidden />
              )}
            </div>
            <span>All profiles</span>
          </button>

          {connections.length > 0 && (
            <div className="my-1 border-t border-white/[0.06]" />
          )}

          {connections.map((conn) => {
            const visible = !hiddenPlatforms.has(conn.platform);
            return (
              <button
                key={conn.id}
                onClick={() => onToggle(conn.platform)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              >
                <div
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    visible ? "border-pk bg-pk" : "border-white/20",
                  )}
                >
                  {visible && (
                    <Check className="h-3 w-3 text-white" aria-hidden />
                  )}
                </div>
                <span className="shrink-0 font-mono text-xs opacity-60">
                  {PLATFORM_ABBR[conn.platform]}
                </span>
                <span className="truncate">
                  {conn.display_name ?? PLATFORM_LABEL[conn.platform]}
                </span>
              </button>
            );
          })}

          {connections.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-m3">
              No connected accounts yet.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// -- Main component -----------------------------------------------------------

export function SocialCalendarClient({
  entries,
  monthIso,
  connections,
  companyName,
}: Props) {
  const [hiddenPlatforms, setHiddenPlatforms] = useState<Set<SocialPlatform>>(
    new Set(),
  );

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

  function togglePlatform(platform: SocialPlatform) {
    setHiddenPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  function showAllPlatforms() {
    setHiddenPlatforms(new Set());
  }

  const entryMap = useMemo(() => {
    const map = new Map<string, Entry[]>();
    const visible =
      hiddenPlatforms.size === 0
        ? entries
        : entries.filter((e) => !hiddenPlatforms.has(e.platform));
    for (const e of visible) {
      const key = localDayKey(new Date(e.scheduled_at));
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [entries, hiddenPlatforms]);

  return (
    <div data-testid="social-calendar">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="flex items-center gap-1.5 text-sm text-m3">
          <li>
            <Link
              href="/company/social"
              className="transition-colors hover:text-white"
            >
              Social
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="font-medium text-white">Calendar</li>
        </ol>
      </nav>

      {/* Header bar */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {/* Company indicator (V1: single-company, read-only) */}
        <div
          className="flex items-center gap-1.5 rounded-md border border-white/[0.1] px-3 py-1.5 text-sm text-m2"
          title={companyName}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
          <span className="max-w-[10rem] truncate">{companyName}</span>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-1">
          <a
            href={`?month=${prevMonth}`}
            aria-label="Previous month"
            data-testid="calendar-prev"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] text-m2 transition-colors hover:bg-white/[0.05] hover:text-white"
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
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.1] text-m2 transition-colors hover:bg-white/[0.05] hover:text-white"
          >
            <ChevronRight aria-hidden className="h-4 w-4" />
          </a>
          {!isCurrentMonth && (
            <a
              href="/company/social/calendar"
              className="ml-1 rounded-md border border-white/[0.1] px-3 py-1 text-sm text-m2 transition-colors hover:bg-white/[0.05] hover:text-white"
              data-testid="calendar-today"
            >
              Today
            </a>
          )}
        </div>

        {/* Right-side controls */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div
            className="flex items-center overflow-hidden rounded-lg border border-white/[0.1]"
            role="group"
            aria-label="View mode"
          >
            <span
              aria-current="page"
              className="flex items-center gap-1.5 border-r border-white/[0.1] bg-pk px-3 py-1.5 text-sm text-white"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Calendar
            </span>
            <Link
              href="/company/social/posts"
              className="flex items-center gap-1.5 border-r border-white/[0.1] px-3 py-1.5 text-sm text-m2 transition-colors hover:bg-white/[0.05] hover:text-white"
            >
              <List className="h-3.5 w-3.5" aria-hidden />
              Posts
            </Link>
            <button
              disabled
              aria-disabled="true"
              title="Coming soon"
              className="flex cursor-not-allowed items-center gap-1.5 px-3 py-1.5 text-sm text-m3 opacity-40"
            >
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Timeline
            </button>
          </div>

          {/* Profiles filter */}
          <ProfilesFilter
            connections={connections}
            hiddenPlatforms={hiddenPlatforms}
            onToggle={togglePlatform}
            onShowAll={showAllPlatforms}
          />

          {/* New post */}
          <Link
            href="/company/social/posts"
            className="inline-flex items-center gap-1.5 rounded-md bg-pk px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-pk/80"
            data-testid="calendar-new-post"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New post
          </Link>
        </div>
      </div>

      {/* Grid */}
      <div
        className="overflow-hidden rounded-lg border border-white/[0.06]"
        role="grid"
        aria-label={`Calendar for ${monthLabel}`}
      >
        {/* Day-of-week header */}
        <div
          className="grid grid-cols-7 border-b border-white/[0.06] bg-white/[0.04]"
          role="row"
        >
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
            const visibleChips = dayEntries.slice(0, MAX_CHIPS);
            const hasOverflow = dayEntries.length > MAX_CHIPS;
            const isLastRow = idx >= 35;
            const isLastCol = idx % 7 === 6;

            return (
              <div
                key={dayKey}
                role="gridcell"
                data-testid={`calendar-day-${dayKey}`}
                className={cn(
                  "group min-h-[6rem] p-1.5",
                  !isLastRow && "border-b border-white/[0.06]",
                  !isLastCol && "border-r border-white/[0.06]",
                  !inMonth && "opacity-30",
                )}
              >
                {/* Date number row */}
                <div className="flex items-center justify-between">
                  {/* + create post hint — visible on hover */}
                  <Link
                    href="/company/social/posts"
                    tabIndex={-1}
                    aria-label={`Create post for ${dayKey}`}
                    className="invisible flex h-5 w-5 items-center justify-center rounded-full text-m3 transition-colors hover:bg-white/10 hover:text-white group-hover:visible"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                  </Link>
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      isToday ? "bg-pk text-white" : "text-m2",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>

                {/* Post chips */}
                <ul className="mt-1 space-y-0.5">
                  {visibleChips.map((e) => (
                    <li key={e.id}>
                      <a
                        href={`/company/social/posts/${e.post_master_id}`}
                        data-testid={`calendar-entry-${e.id}`}
                        className={cn(
                          "flex items-center gap-1 truncate rounded px-1 py-0.5 text-xs leading-tight transition-opacity hover:opacity-80",
                          CHIP_CLASS[e.platform],
                        )}
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

                {/* Overflow popover */}
                {hasOverflow && (
                  <DayOverflowPopover dayKey={dayKey} dayEntries={dayEntries} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Total count */}
      {entries.length > 0 && (
        <p
          className="mt-3 text-right text-xs text-m3"
          data-testid="calendar-count"
        >
          {entries.length} {entries.length === 1 ? "post" : "posts"} this month
        </p>
      )}
    </div>
  );
}
