import { describe, expect, it } from "vitest";

import {
  evaluateRollout,
  type StagedRolloutConfig,
} from "@/lib/optimiser/staged-rollout/evaluator";

// OPTIMISER PHASE 1.5 SLICE 16 — threshold evaluator unit matrix.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const baseConfig: StagedRolloutConfig = {
  initial_traffic_split_percent: 20,
  minimum_sessions: 300,
  minimum_conversions: 10,
  minimum_time_hours: 48,
  cr_drop_rollback_pct: 15, // 15% relative drop
  cr_drop_significance: 0.9, // p ≥ 0.90
  bounce_spike_rollback_pct: 25,
  error_spike_rollback_rate: 0.01,
  maximum_window_days: 7,
};

const baselinePerfect = {
  sessions_baseline: 1200,
  conversions_baseline: 60, // 5% CR
  bounces_baseline: 240, // 20% bounce
};

describe("evaluateRollout", () => {
  it("waits when floors are not yet met", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 100, // < 300
        conversions_new: 6,
        bounces_new: 18,
        errors_new: 0,
        ...baselinePerfect,
      },
      age_ms: 24 * HOUR, // < 48 hours
    });
    expect(r.decision).toBe("wait");
    expect(r.trips).toEqual([]);
  });

  it("promotes when all floors met and metrics steady", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 400,
        conversions_new: 22, // 5.5% CR — better than baseline 5%
        bounces_new: 80,
        errors_new: 1,
        ...baselinePerfect,
      },
      age_ms: 50 * HOUR,
    });
    expect(r.decision).toBe("promote");
    expect(r.observed.floors_met.sessions).toBe(true);
    expect(r.observed.floors_met.conversions).toBe(true);
    expect(r.observed.floors_met.time).toBe(true);
  });

  it("rollbacks on error rate spike — error trumps everything", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 500,
        conversions_new: 25,
        bounces_new: 100,
        errors_new: 10, // 2% error rate > 1%
        ...baselinePerfect,
      },
      age_ms: 50 * HOUR,
    });
    expect(r.decision).toBe("rollback");
    expect(r.trips.some((t) => t.startsWith("error_rate"))).toBe(true);
  });

  it("rollbacks on bounce spike", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 500,
        conversions_new: 25,
        bounces_new: 150, // 30% bounce vs 20% baseline → 50% relative spike
        errors_new: 0,
        ...baselinePerfect,
      },
      age_ms: 50 * HOUR,
    });
    expect(r.decision).toBe("rollback");
    expect(r.trips.some((t) => t.startsWith("bounce_spike"))).toBe(true);
  });

  it("rollbacks on a statistically significant CR drop", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 2000, // big sample so the drop is significant
        conversions_new: 60, // 3% CR — 40% drop from 5% baseline
        bounces_new: 400,
        errors_new: 0,
        ...baselinePerfect,
        sessions_baseline: 2000,
        conversions_baseline: 100,
      },
      age_ms: 60 * HOUR,
    });
    expect(r.decision).toBe("rollback");
    expect(r.trips.some((t) => t.startsWith("cr_drop"))).toBe(true);
  });

  it("does NOT rollback on CR drop without statistical significance (small sample)", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 305, // just above floor
        conversions_new: 12, // 3.93% — visible drop but tiny n
        bounces_new: 60,
        errors_new: 0,
        ...baselinePerfect,
      },
      age_ms: 50 * HOUR,
    });
    // Floors met → promote unless trip. Small sample p-value won't
    // satisfy the 0.90 significance threshold.
    expect(r.decision).toBe("promote");
  });

  it("returns window_expired after maximum_window_days even without floors", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 50, // way below floor
        conversions_new: 1,
        bounces_new: 10,
        errors_new: 0,
        ...baselinePerfect,
      },
      age_ms: 8 * DAY, // past 7-day max
    });
    expect(r.decision).toBe("window_expired");
  });

  it("rollback wins over window_expired (broken page mid-window)", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 500,
        conversions_new: 25,
        bounces_new: 100,
        errors_new: 100, // 20% error rate
        ...baselinePerfect,
      },
      age_ms: 8 * DAY,
    });
    expect(r.decision).toBe("rollback");
  });

  it("collects all trips even when only the first decides", () => {
    const r = evaluateRollout({
      config: baseConfig,
      metrics: {
        sessions_new: 500,
        conversions_new: 5, // big CR drop
        bounces_new: 200, // big bounce spike
        errors_new: 50, // big error rate
        ...baselinePerfect,
      },
      age_ms: 60 * HOUR,
    });
    expect(r.decision).toBe("rollback");
    expect(r.trips.length).toBeGreaterThanOrEqual(2);
  });

  it("respects per-client overrides on thresholds", () => {
    const looser: StagedRolloutConfig = {
      ...baseConfig,
      cr_drop_rollback_pct: 50, // very loose
      bounce_spike_rollback_pct: 100, // very loose
      error_spike_rollback_rate: 0.5, // very loose
    };
    const r = evaluateRollout({
      config: looser,
      metrics: {
        sessions_new: 500,
        conversions_new: 20,
        bounces_new: 150, // 30% bounce; spike is 50% — under the 100% threshold
        errors_new: 50, // 10% error; under 50% threshold
        ...baselinePerfect,
        conversions_baseline: 50, // 4.17% baseline → CR drop ≈ 4% under threshold
      },
      age_ms: 60 * HOUR,
    });
    expect(r.decision).toBe("promote");
  });
});
