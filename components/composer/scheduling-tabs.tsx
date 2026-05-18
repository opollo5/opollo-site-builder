"use client";

import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// Spec 22 — SchedulingTabs.
//
// Four-tab row: Post now | Schedule | Save as draft | Publish regularly
// (last tab is disabled stub per spec §3 exclusions).
//
// When mode === "schedule", renders a date picker + up to 10 time inputs.
// Times are in UTC (V1); timezone picker is a follow-up.
// ---------------------------------------------------------------------------

export type ComposerMode = "post_now" | "schedule" | "draft";

interface SchedulingTabsProps {
  mode: ComposerMode;
  scheduleDate: string;     // YYYY-MM-DD
  scheduleTimes: string[];  // HH:MM[], min 1 when in schedule mode
  onModeChange: (mode: ComposerMode) => void;
  onScheduleDate: (date: string) => void;
  onScheduleTime: (time: string, index: number) => void;
  onAddScheduleTime: () => void;
  onRemoveScheduleTime: (index: number) => void;
  disabled?: boolean;
}

const MAX_TIMES = 10;

const TABS: { id: ComposerMode | "recurring"; label: string; disabled?: boolean }[] = [
  { id: "post_now", label: "Post now" },
  { id: "schedule", label: "Schedule" },
  { id: "draft", label: "Save as draft" },
  { id: "recurring", label: "Publish regularly", disabled: true },
];

export function SchedulingTabs({
  mode,
  scheduleDate,
  scheduleTimes,
  onModeChange,
  onScheduleDate,
  onScheduleTime,
  onAddScheduleTime,
  onRemoveScheduleTime,
  disabled,
}: SchedulingTabsProps) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      {/* Tab bar */}
      <div className="flex gap-0.5 rounded-md border border-white/10 p-0.5 text-xs">
        {TABS.map((tab) => {
          const isActive = !tab.disabled && tab.id === mode;
          return (
            <button
              key={tab.id}
              type="button"
              disabled={disabled || tab.disabled}
              title={tab.disabled ? "Coming soon" : undefined}
              onClick={() => {
                if (!tab.disabled && tab.id !== "recurring") {
                  onModeChange(tab.id as ComposerMode);
                }
              }}
              className={[
                "rounded px-3 py-1.5 transition-colors",
                tab.disabled
                  ? "cursor-not-allowed text-muted-foreground/30"
                  : isActive
                    ? "bg-white/10 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                disabled && !tab.disabled ? "opacity-50" : "",
              ].join(" ")}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Date / time pickers — only shown in Schedule mode */}
      {mode === "schedule" && (
        <div className="flex flex-wrap items-start gap-3">
          {/* Date */}
          <div className="flex items-center gap-2">
            <NavIcon name="calendar-full" size={14} className="shrink-0 text-muted-foreground" />
            <input
              type="date"
              value={scheduleDate}
              min={today}
              onChange={(e) => onScheduleDate(e.target.value)}
              disabled={disabled}
              className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
            />
          </div>

          {/* Times list */}
          <div className="flex flex-col gap-1.5">
            {scheduleTimes.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <NavIcon name="clock" size={14} className="shrink-0 text-muted-foreground" />
                <input
                  type="time"
                  value={t}
                  onChange={(e) => onScheduleTime(e.target.value, i)}
                  disabled={disabled}
                  aria-label={`Schedule time ${i + 1}`}
                  className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
                />
                <span className="text-xs text-muted-foreground">UTC</span>
                {scheduleTimes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onRemoveScheduleTime(i)}
                    disabled={disabled}
                    aria-label={`Remove time ${i + 1}`}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                  >
                    <NavIcon name="cross" size={12} />
                  </button>
                )}
              </div>
            ))}

            {scheduleTimes.length < MAX_TIMES && (
              <button
                type="button"
                onClick={onAddScheduleTime}
                disabled={disabled}
                className="self-start text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                + Add time
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
