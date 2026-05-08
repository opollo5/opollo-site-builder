"use client";

import { NavIcon } from "@/components/ui/nav-icon";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — SchedulingTabs.
//
// Four-tab row: Post now | Schedule | Save as draft | Publish regularly
// (last tab is disabled stub per spec §3 exclusions).
//
// When mode === "schedule", renders date + time inputs below the tab bar.
// Times are in UTC (V1); timezone picker is a follow-up.
// ---------------------------------------------------------------------------

export type ComposerMode = "post_now" | "schedule" | "draft";

interface SchedulingTabsProps {
  mode: ComposerMode;
  scheduleDate: string;    // YYYY-MM-DD
  scheduleTime: string;    // HH:MM
  onModeChange: (mode: ComposerMode) => void;
  onScheduleDate: (date: string) => void;
  onScheduleTime: (time: string) => void;
  disabled?: boolean;
}

const TABS: { id: ComposerMode | "recurring"; label: string; disabled?: boolean }[] = [
  { id: "post_now", label: "Post now" },
  { id: "schedule", label: "Schedule" },
  { id: "draft", label: "Save as draft" },
  { id: "recurring", label: "Publish regularly", disabled: true },
];

export function SchedulingTabs({
  mode,
  scheduleDate,
  scheduleTime,
  onModeChange,
  onScheduleDate,
  onScheduleTime,
  disabled,
}: SchedulingTabsProps) {
  // Today's date in YYYY-MM-DD for min attribute.
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
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <NavIcon name="calendar-full" size={14} className="text-muted-foreground" />
            <input
              type="date"
              value={scheduleDate}
              min={today}
              onChange={(e) => onScheduleDate(e.target.value)}
              disabled={disabled}
              className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
            />
          </div>
          <div className="flex items-center gap-2">
            <NavIcon name="clock" size={14} className="text-muted-foreground" />
            <input
              type="time"
              value={scheduleTime}
              onChange={(e) => onScheduleTime(e.target.value)}
              disabled={disabled}
              className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
            />
            <span className="text-xs text-muted-foreground">UTC</span>
          </div>
        </div>
      )}
    </div>
  );
}
