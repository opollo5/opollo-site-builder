"use client";

import { useMemo, useState } from "react";

import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-25 — calendar list view.
//
// Server fetches a 30-day window of non-cancelled schedule entries.
// The component groups by date (YYYY-MM-DD in the company's timezone
// — for V1 we fall back to the operator's browser timezone since
// platform_companies.timezone isn't threaded through the page yet),
// and offers a platform filter chip-row.
//
// Each entry links to /company/social/posts/[post_master_id] for
// detail + edit + retry.
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
};

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

const PLATFORM_PILL: Record<SocialPlatform, string> = {
  linkedin_personal: "bg-blue-100 text-blue-900",
  linkedin_company: "bg-blue-100 text-blue-900",
  facebook_page: "bg-indigo-100 text-indigo-900",
  x: "bg-slate-200 text-slate-900",
  gbp: "bg-emerald-100 text-emerald-900",
};

export function SocialCalendarClient({ entries }: Props) {
  const [filter, setFilter] = useState<SocialPlatform | "all">("all");

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
          Nothing scheduled in the next 30 days
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
