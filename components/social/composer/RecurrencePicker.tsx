"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { RecurrenceRule } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// RecurrencePicker — builds an RFC 5545 RRULE string from simple UI controls.
//
// CLAUDE-ASSUMPTION: Defaulted RRULE FREQ to WEEKLY since wireframe 06 shows
// weekly as the most common case. User can override via the frequency select.
// ---------------------------------------------------------------------------

type FreqUnit = "daily" | "weekly" | "monthly";

interface RecurrenceState {
  interval: number;
  freq: FreqUnit;
  startingDate: string; // "YYYY-MM-DD"
  startingTime: string; // "HH:MM"
  noEndDate: boolean;
  untilDate: string; // "YYYY-MM-DD", only used when noEndDate=false
}

export interface RecurrencePickerProps {
  value: RecurrenceRule;
  onChange: (v: RecurrenceRule) => void;
  className?: string;
}

function buildRrule(state: RecurrenceState): RecurrenceRule {
  const freqMap: Record<FreqUnit, string> = {
    daily: "DAILY",
    weekly: "WEEKLY",
    monthly: "MONTHLY",
  };

  const rule = `FREQ=${freqMap[state.freq]};INTERVAL=${state.interval}`;
  const startingAt = `${state.startingDate}T${state.startingTime}:00`;
  const until = !state.noEndDate && state.untilDate ? state.untilDate : undefined;

  return {
    rule,
    starting_at: startingAt,
    until: until ? `${until}T23:59:59` : undefined,
  };
}

function parseRrule(value: RecurrenceRule): RecurrenceState {
  const freqMatch = /FREQ=(\w+)/.exec(value.rule);
  const intervalMatch = /INTERVAL=(\d+)/.exec(value.rule);

  const freqRaw = freqMatch?.[1]?.toLowerCase() ?? "weekly";
  const freq: FreqUnit =
    freqRaw === "daily" || freqRaw === "weekly" || freqRaw === "monthly"
      ? freqRaw
      : "weekly";

  const interval = parseInt(intervalMatch?.[1] ?? "1", 10);

  const startParts = value.starting_at.split("T");
  const startingDate = startParts[0] ?? todayString();
  const startingTime = (startParts[1] ?? "09:00").slice(0, 5);

  const untilParts = value.until?.split("T");
  const untilDate = untilParts?.[0] ?? "";

  return {
    interval,
    freq,
    startingDate,
    startingTime,
    noEndDate: !value.until,
    untilDate,
  };
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const DEFAULT_RULE: RecurrenceRule = {
  rule: "FREQ=WEEKLY;INTERVAL=1",
  starting_at: `${tomorrowString()}T09:00:00`,
};

export function RecurrencePicker({ value = DEFAULT_RULE, onChange, className }: RecurrencePickerProps) {
  const [state, setState] = React.useState<RecurrenceState>(() => parseRrule(value));

  function update(partial: Partial<RecurrenceState>) {
    const next = { ...state, ...partial };
    setState(next);
    onChange(buildRrule(next));
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Repeat frequency */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground whitespace-nowrap">Repeat every</span>
        <input
          type="number"
          min={1}
          max={99}
          value={state.interval}
          onChange={(e) => update({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          className="w-16 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Repeat interval"
        />
        <select
          value={state.freq}
          onChange={(e) => update({ freq: e.target.value as FreqUnit })}
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Repeat frequency"
        >
          <option value="daily">days</option>
          <option value="weekly">weeks</option>
          <option value="monthly">months</option>
        </select>
      </div>

      {/* Starting date + time */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-foreground">Starting on</label>
        <div className="flex gap-2">
          <input
            type="date"
            value={state.startingDate}
            min={todayString()}
            onChange={(e) => update({ startingDate: e.target.value })}
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Starting date"
          />
          <input
            type="time"
            value={state.startingTime}
            onChange={(e) => update({ startingTime: e.target.value })}
            className="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Starting time"
          />
        </div>
      </div>

      {/* Until / no-end */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="no-end-date"
            checked={state.noEndDate}
            onChange={(e) => update({ noEndDate: e.target.checked })}
            className="h-4 w-4 rounded border border-border accent-primary"
          />
          <label htmlFor="no-end-date" className="text-sm text-foreground cursor-pointer">
            No end date
          </label>
        </div>
        {!state.noEndDate && (
          <input
            type="date"
            value={state.untilDate}
            min={state.startingDate}
            onChange={(e) => update({ untilDate: e.target.value })}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label="Until date"
            placeholder="End date"
          />
        )}
      </div>
    </div>
  );
}
