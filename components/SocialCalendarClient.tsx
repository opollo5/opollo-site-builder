"use client";

import { useMemo, useState } from "react";

import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-25/S1-32 — calendar list view with 30-day window navigation.
//
// The server page passes fromIso/toIso. Prev/Next nav links update the
// ?from= query param (full page reload — server re-fetches the window).
// Platform filter chips are client-only state over the already-fetched
// entries.
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
  fromIso: string;
  toIso: string;
};

const WINDOW_DAYS = 30;

const PLATFORMS: SocialPlatform[] = [
  "linkedin_personal",
  "linkedin_company",
  "facebook_page",
  "x",
  "gbp",
];

function dayKey(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toFromParam(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

const PLATFORM_PILL: Record<SocialPlatform, string> = {
  linkedin_personal: "bg-blue-100 text-blue-900",
  linkedin_company: "bg-blue-100 text-blue-900",
  facebook_page: "bg-indigo-100 text-indigo-900",
  x: "bg-slate-200 text-slate-900",
  gbp: "bg-emerald-100 text-emerald-900",
};

export function SocialCalendarClient({ entries, fromIso, toIso }: Props) {
  const [filter, setFilter] = useState<SocialPlatform | "all">("all");

  const from = new Date(fromIso);
  const to = new Date(toIso);

  const prevFrom = shiftDays(fromIso, -WINDOW_DAYS);
  const nextFrom = shiftDays(fromIso, WINDOW_DAYS);
  const todayFrom = new Date().toISOString();
  const isToday =
    toFromParam(fromIso) === toFromParam(todayFrom);

  const windowLabel = `${from.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${to.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  const visible = useMemo(
    () => entries.filter((e) => filter === "all" || e.platform === filter),
    [entries, filter],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of visible) {
      const key = dayKey(e.scheduled_at);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [visible]);

  return (
    <div data-testid="social-calendar">
      {/* Window navigation */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <a
            href={`?from=${toFromParam(prevFrom)}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            aria-label="Previous period"
            data-testid="calendar-prev"
          >
            ‹ Prev
          </a>
          {!isToday && (
            <a
              href="/company/social/calendar"
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              data-testid="calendar-today"
            >
              Today
            </a>
          )}
          <a
            href={`?from=${toFromParam(nextFrom)}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            aria-label="Next period"
            data-testid="calendar-next"
          >
            Next ›
          </a>
        </div>
        <span className="text-sm text-muted-foreground" data-testid="calendar-window-label">
          {windowLabel}
        </span>
      </div>

      {/* Platform filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            filter === "all"
              ? "bg-primary text-primary-foreground"
              : "border bg-background"
          }`}
          data-testid="calendar-filter-all"
        >
          All
        </button>
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setFilter(p)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              filter === p
                ? "bg-primary text-primary-foreground"
                : "border bg-background"
            }`}
            data-testid={`calendar-filter-${p}`}
          >
            {PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <div
          className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground"
          data-testid="calendar-empty"
        >
          Nothing scheduled in this window
          {filter === "all" ? "" : ` for ${PLATFORM_LABEL[filter]}`}.
        </div>
      ) : (
        <ol className="space-y-6" data-testid="calendar-days">
          {grouped.map(([day, items]) => (
            <li key={day}>
              <h3 className="mb-2 text-base font-semibold">{day}</h3>
              <ul className="divide-y rounded-lg border bg-card">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start gap-3 p-3"
                    data-testid={`calendar-entry-${e.id}`}
                  >
                    <div className="w-16 shrink-0 text-sm font-medium tabular-nums">
                      {timeLabel(e.scheduled_at)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-sm font-medium ${PLATFORM_PILL[e.platform]}`}
                        >
                          {PLATFORM_LABEL[e.platform]}
                        </span>
                      </div>
                      <a
                        href={`/company/social/posts/${e.post_master_id}`}
                        className="mt-1 block break-words text-sm text-primary underline"
                      >
                        {e.preview ?? "(no copy)"}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
