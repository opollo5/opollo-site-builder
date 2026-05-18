"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ScheduleRow, type ScheduleRowValue } from "@/components/social/composer/ScheduleRow";
import { RecurrencePicker } from "@/components/social/composer/RecurrencePicker";
import { ApprovalToggle } from "@/components/social/composer/ApprovalToggle";
import type { SchedulingMode, RecurrenceRule } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// SchedulingCard — four-tab scheduling UI.
// PR E: wires SchedulingCard + ApprovalToggle into ComposerEditor.schedulingSlot.
//
// Tabs: Post now | Schedule | Publish regularly | Save as draft
// ---------------------------------------------------------------------------

export interface SchedulingCardValue {
  mode: SchedulingMode;
  scheduledTimes: ScheduleRowValue[];
  recurrence: RecurrenceRule;
  plannedForAt: ScheduleRowValue | null;
  approvalRequired: boolean;
}

export interface SchedulingCardProps {
  value: SchedulingCardValue;
  onChange: (v: SchedulingCardValue) => void;
  /** Called when user clicks the primary action button. */
  onSubmit: () => Promise<void>;
  submitting?: boolean;
  /** Disable submit — e.g. no profiles selected or content empty. */
  disabled?: boolean;
}

type Tab = { mode: SchedulingMode; label: string; submitLabel: string };

const TABS: Tab[] = [
  { mode: "post_now",   label: "Post now",          submitLabel: "Post now" },
  { mode: "schedule",   label: "Schedule",           submitLabel: "Schedule post" },
  { mode: "recurring",  label: "Publish regularly",  submitLabel: "Save schedule" },
  { mode: "draft",      label: "Save as draft",      submitLabel: "Save draft" },
];

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_RECURRENCE: RecurrenceRule = {
  rule: "FREQ=WEEKLY;INTERVAL=1",
  starting_at: `${todayPlusDays(1)}T09:00:00`,
};

export function defaultSchedulingCardValue(): SchedulingCardValue {
  return {
    mode: "post_now",
    scheduledTimes: [{ date: todayPlusDays(1), time: "09:00" }],
    recurrence: DEFAULT_RECURRENCE,
    plannedForAt: null,
    approvalRequired: false,
  };
}

export function SchedulingCard({
  value,
  onChange,
  onSubmit,
  submitting = false,
  disabled = false,
}: SchedulingCardProps) {
  const activeTab = TABS.find((t) => t.mode === value.mode) ?? TABS[0]!;

  function setMode(mode: SchedulingMode) {
    onChange({ ...value, mode });
  }

  function addScheduleRow() {
    const last = value.scheduledTimes[value.scheduledTimes.length - 1];
    const lastDate = last?.date ?? todayPlusDays(1);
    const d = new Date(lastDate);
    d.setDate(d.getDate() + 1);
    const nextDate = d.toISOString().slice(0, 10);
    onChange({
      ...value,
      scheduledTimes: [...value.scheduledTimes, { date: nextDate, time: last?.time ?? "09:00" }],
    });
  }

  function removeScheduleRow(i: number) {
    onChange({
      ...value,
      scheduledTimes: value.scheduledTimes.filter((_, idx) => idx !== i),
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      {/* Tab row */}
      <div
        role="tablist"
        aria-label="Scheduling mode"
        className="flex items-center gap-0.5 overflow-x-auto"
      >
        {TABS.map((tab) => {
          const isActive = tab.mode === value.mode;
          return (
            <button
              key={tab.mode}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setMode(tab.mode)}
              className={cn(
                "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--tab-active-bg)] text-[var(--tab-active-text)]"
                  : "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div role="tabpanel">
        {value.mode === "post_now" && (
          <p className="text-sm text-muted-foreground">
            This post will be published immediately to the selected profiles.
          </p>
        )}

        {value.mode === "schedule" && (
          <div className="flex flex-col gap-3">
            {value.scheduledTimes.map((row, i) => (
              <ScheduleRow
                key={i}
                value={row}
                minDate={todayString()}
                onChange={(v) => {
                  const next = [...value.scheduledTimes];
                  next[i] = v;
                  onChange({ ...value, scheduledTimes: next });
                }}
                onRemove={value.scheduledTimes.length > 1 ? () => removeScheduleRow(i) : undefined}
              />
            ))}
            <button
              type="button"
              onClick={addScheduleRow}
              className="self-start text-sm font-medium text-primary hover:underline"
            >
              + Add time
            </button>
          </div>
        )}

        {value.mode === "recurring" && (
          <RecurrencePicker
            value={value.recurrence}
            onChange={(r) => onChange({ ...value, recurrence: r })}
          />
        )}

        {value.mode === "draft" && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Planned time is a hint to your team — the post will not auto-publish.
            </p>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-foreground whitespace-nowrap">
                Plan for
              </label>
              <input
                type="date"
                value={value.plannedForAt?.date ?? ""}
                min={todayString()}
                onChange={(e) =>
                  onChange({
                    ...value,
                    plannedForAt: { date: e.target.value, time: value.plannedForAt?.time ?? "09:00" },
                  })
                }
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Planned date"
              />
              <input
                type="time"
                value={value.plannedForAt?.time ?? "09:00"}
                onChange={(e) =>
                  onChange({
                    ...value,
                    plannedForAt: { date: value.plannedForAt?.date ?? "", time: e.target.value },
                  })
                }
                className="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Planned time"
              />
            </div>
          </div>
        )}
      </div>

      {/* Approval toggle — hidden for Post now */}
      {value.mode !== "post_now" && (
        <ApprovalToggle
          value={value.approvalRequired}
          onChange={(v) => onChange({ ...value, approvalRequired: v })}
        />
      )}

      {/* Submit row */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {value.mode === "schedule" && value.scheduledTimes.length > 1
            ? `${value.scheduledTimes.length} posts will be created`
            : null}
          {value.mode === "recurring"
            ? "6 upcoming posts will be scheduled"
            : null}
        </p>
        <button
          type="button"
          data-testid="composer-submit"
          disabled={disabled || submitting}
          onClick={onSubmit}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          {submitting ? "Saving…" : activeTab.submitLabel}
        </button>
      </div>
    </div>
  );
}
