"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABEL,
  SUPPORTED_PLATFORMS,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-14 — schedule entries section on the post detail page.
//
// Visible when post.state='approved'. Approver+ (canSchedule) can
// add new entries + cancel existing ones. Viewers see the list
// read-only.
//
// V1 shows non-cancelled entries only. A future slice can add a
// "show cancelled" toggle that re-fetches with include_cancelled=true.
// ---------------------------------------------------------------------------

type Entry = {
  id: string;
  post_variant_id: string;
  platform: SocialPlatform;
  scheduled_at: string;
  cancelled_at: string | null;
  qstash_message_id: string | null;
  scheduled_by: string | null;
  created_at: string;
};

type Props = {
  postId: string;
  companyId: string;
  initialEntries: Entry[];
  canSchedule: boolean;
};

export function PostScheduleSection({
  postId,
  companyId,
  initialEntries,
  canSchedule,
}: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [adding, setAdding] = useState(false);
  const [platform, setPlatform] = useState<SocialPlatform>("linkedin_personal");
  const [scheduledAt, setScheduledAt] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // The form gives us a local datetime ('2026-05-12T09:00').
      // Convert to ISO with the browser's timezone.
      const isoFromLocal = new Date(scheduledAt).toISOString();
      const res = await fetch(
        `/api/platform/social/posts/${postId}/schedule`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: companyId,
            platform,
            scheduled_at: isoFromLocal,
          }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { entry: Entry } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to schedule.";
        setError(msg);
        return;
      }
      setEntries((prev) => {
        const next = [...prev, json.data.entry];
        next.sort(
          (a, b) =>
            Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at),
        );
        return next;
      });
      setAdding(false);
      setScheduledAt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(entryId: string) {
    if (!confirm("Cancel this schedule entry?")) return;
    setCancellingId(entryId);
    setError(null);
    try {
      const url = `/api/platform/social/posts/${postId}/schedule/${entryId}?company_id=${encodeURIComponent(companyId)}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = (await res.json()) as
        | { ok: true; data: { entry: Entry } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to cancel.";
        setError(msg);
        return;
      }
      // Drop from the visible list (we don't show cancelled in V1).
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancellingId(null);
    }
  }

  // Default datetime: tomorrow 09:00 local, formatted for
  // <input type="datetime-local">.
  function defaultDatetimeValue(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  return (
    <section className="mt-8" data-testid="post-schedule-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Schedule</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One schedule entry per platform. Cancel and re-schedule if
            you need to change a time.
          </p>
        </div>
        {canSchedule && !adding ? (
          <Button
            onClick={() => {
              setScheduledAt(defaultDatetimeValue());
              setAdding(true);
            }}
            data-testid="schedule-add-button"
          >
            Add schedule
          </Button>
        ) : null}
      </div>

      {error ? (
        <p
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="schedule-error"
        >
          {error}
        </p>
      ) : null}

      {adding ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-lg border bg-card p-4"
          data-testid="schedule-add-form"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="schedule_platform"
              >
                Platform
              </label>
              <select
                id="schedule_platform"
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
                data-testid="schedule-add-platform"
              >
                {SUPPORTED_PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="schedule_at"
              >
                When
              </label>
              <input
                id="schedule_at"
                type="datetime-local"
                required
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                data-testid="schedule-add-datetime"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              type="submit"
              disabled={submitting}
              data-testid="schedule-add-submit"
            >
              {submitting ? "Scheduling…" : "Schedule"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {entries.length === 0 ? (
        <div
          className="mt-4 rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="schedule-empty"
        >
          No schedule entries yet.
          {canSchedule
            ? " Click Add schedule to publish this post on a date and time."
            : " An approver can add scheduled times for each platform."}
        </div>
      ) : (
        <ul
          className="mt-4 divide-y rounded-lg border bg-card"
          data-testid="schedule-list"
        >
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
              data-testid={`schedule-row-${e.id}`}
            >
              <div>
                <div className="font-medium">{PLATFORM_LABEL[e.platform]}</div>
                <div className="text-sm text-muted-foreground tabular-nums">
                  {new Date(e.scheduled_at).toLocaleString("en-AU", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              {canSchedule ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCancel(e.id)}
                  disabled={cancellingId === e.id}
                  data-testid={`schedule-cancel-${e.id}`}
                >
                  {cancellingId === e.id ? "Cancelling…" : "Cancel"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
