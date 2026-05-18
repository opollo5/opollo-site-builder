"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ScheduleRowValue {
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
}

export interface ScheduleRowProps {
  value: ScheduleRowValue;
  onChange: (v: ScheduleRowValue) => void;
  onRemove?: () => void;
  minDate?: string; // "YYYY-MM-DD"
  className?: string;
}

export function ScheduleRow({ value, onChange, onRemove, minDate, className }: ScheduleRowProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <input
        type="date"
        value={value.date}
        min={minDate}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Scheduled date"
      />
      <input
        type="time"
        value={value.time}
        onChange={(e) => onChange({ ...value, time: e.target.value })}
        className="w-28 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        aria-label="Scheduled time"
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this time"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
