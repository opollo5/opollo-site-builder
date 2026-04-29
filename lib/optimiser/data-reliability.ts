import "server-only";

import type { OptDataReliability } from "./types";
import type { PageMetricsRollup } from "./metrics-aggregation";

// ---------------------------------------------------------------------------
// Data reliability indicator (§9.3 v1.5).
//
// Three checks per the spec:
//   - sessions_clear  : sessions >= 100 in the analysis window
//   - freshness_clear : latest metric_date within the freshness window (7d default)
//   - behaviour_clear : Clarity scroll/engagement OR GA4 bounce rate present
//
// Indicator:
//   green : all three pass
//   amber : at least one passes but not all
//   red   : none pass
// ---------------------------------------------------------------------------

export type ReliabilityChecks = {
  sessions_clear: boolean;
  freshness_clear: boolean;
  behaviour_clear: boolean;
  sessions: number;
  freshness_age_days: number | null;
  notes: string[];
};

export type ReliabilityResult = {
  reliability: OptDataReliability;
  checks: ReliabilityChecks;
};

export type ReliabilityThresholds = {
  /** Min sessions; default 100. */
  min_sessions?: number;
  /** Max age of latest metric in days; default 7. */
  freshness_window_days?: number;
};

export function computeReliability(
  rollup: PageMetricsRollup,
  thresholds: ReliabilityThresholds = {},
): ReliabilityResult {
  const minSessions = thresholds.min_sessions ?? 100;
  const freshnessWindow = thresholds.freshness_window_days ?? 7;
  const sessions_clear = rollup.sessions >= minSessions;
  const freshness_clear =
    rollup.freshness_age_days != null && rollup.freshness_age_days <= freshnessWindow;
  const behaviour_clear =
    rollup.avg_scroll_depth > 0 ||
    rollup.avg_engagement_time_s > 0 ||
    rollup.bounce_rate > 0;

  const passed = [sessions_clear, freshness_clear, behaviour_clear].filter(
    Boolean,
  ).length;

  let reliability: OptDataReliability;
  if (passed === 3) reliability = "green";
  else if (passed === 0) reliability = "red";
  else reliability = "amber";

  const notes: string[] = [];
  if (!sessions_clear) {
    notes.push(`sessions ${rollup.sessions} < ${minSessions}`);
  }
  if (!freshness_clear) {
    if (rollup.freshness_age_days == null) {
      notes.push("no metrics ingested yet");
    } else {
      notes.push(`latest metric ${rollup.freshness_age_days}d old (>${freshnessWindow}d)`);
    }
  }
  if (!behaviour_clear) {
    notes.push("no behaviour data (Clarity / GA4)");
  }

  return {
    reliability,
    checks: {
      sessions_clear,
      freshness_clear,
      behaviour_clear,
      sessions: rollup.sessions,
      freshness_age_days: rollup.freshness_age_days,
      notes,
    },
  };
}
