// ---------------------------------------------------------------------------
// Spec 11 — heuristic length feedback for SEO title + meta description.
//
// Modern Google truncation depends on pixel width, query bolding, and
// viewport — these thresholds are UX guidance, not exact predictions.
// Helper text uses qualifying language ("typically good" / "may truncate"
// / "likely truncates"), never definitive wording.
// ---------------------------------------------------------------------------

export type LengthState =
  | "critical-low"
  | "low"
  | "ok"
  | "good"
  | "high"
  | "critical-high";

export type LengthColor = "red" | "orange" | "green";

export interface LengthFeedback {
  state: LengthState;
  color: LengthColor;
  /**
   * Qualifying label: "too short" / "getting there" / "typically good" /
   * "may truncate" / "likely truncates". Empty input → "too short" still.
   */
  label: string;
  /**
   * Progress percentage clamped to 0–100. Drives the visual bar width.
   * Anchored to the upper end of the "good" range so the bar fills as
   * the operator types into the green zone.
   */
  percentage: number;
}

interface Bucket {
  state: LengthState;
  color: LengthColor;
  label: string;
  /** inclusive lower bound */
  min: number;
}

// Buckets defined per the brief — last bucket has no upper cap.
const SEO_TITLE_BUCKETS: Bucket[] = [
  { state: "critical-low", color: "red", label: "too short", min: 0 },
  { state: "low", color: "orange", label: "getting there", min: 20 },
  { state: "good", color: "green", label: "typically good", min: 50 },
  { state: "high", color: "orange", label: "may truncate", min: 61 },
  { state: "critical-high", color: "red", label: "likely truncates", min: 71 },
];

const META_DESCRIPTION_BUCKETS: Bucket[] = [
  { state: "critical-low", color: "red", label: "too short", min: 0 },
  { state: "low", color: "orange", label: "getting there", min: 50 },
  { state: "good", color: "green", label: "typically good", min: 120 },
  { state: "high", color: "orange", label: "may truncate", min: 157 },
  { state: "critical-high", color: "red", label: "likely truncates", min: 171 },
];

// Anchor for the progress bar: the upper bound of the "good" range. We cap
// length / anchor at 1 so titles past the green zone still show a full bar
// (consistent with most UX progress-bar conventions — operators read past-
// full as "too long" via the colour change, not the bar width).
const SEO_TITLE_ANCHOR = 60;
const META_DESCRIPTION_ANCHOR = 156;

function pickBucket(buckets: Bucket[], length: number): Bucket {
  // Iterate descending so the first bucket whose min ≤ length wins.
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (length >= buckets[i].min) return buckets[i];
  }
  return buckets[0];
}

function percentageOf(length: number, anchor: number): number {
  if (length <= 0) return 0;
  return Math.min(100, Math.round((length / anchor) * 100));
}

export function getSeoTitleFeedback(length: number): LengthFeedback {
  const bucket = pickBucket(SEO_TITLE_BUCKETS, length);
  return {
    state: bucket.state,
    color: bucket.color,
    label: bucket.label,
    percentage: percentageOf(length, SEO_TITLE_ANCHOR),
  };
}

export function getMetaDescriptionFeedback(length: number): LengthFeedback {
  const bucket = pickBucket(META_DESCRIPTION_BUCKETS, length);
  return {
    state: bucket.state,
    color: bucket.color,
    label: bucket.label,
    percentage: percentageOf(length, META_DESCRIPTION_ANCHOR),
  };
}
