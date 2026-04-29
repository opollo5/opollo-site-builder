// Percentile-based normalisation helper for the behaviour and
// conversion sub-scores. Normalises a value against the client's
// active-pages 25th–75th percentile range so a B2B page with 90s
// engagement isn't penalised against a B2C page with 15s engagement.
//
// Mapping:
//   - value at or below p25 → 0
//   - value at or above p75 → 100
//   - linear interpolation in between
//
// `direction = 'higher_is_better'` follows the rule above.
// `direction = 'lower_is_better'` (e.g. bounce rate, CPA) inverts:
//   p25 → 100, p75 → 0.

export type Direction = "higher_is_better" | "lower_is_better";

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return sorted[lo] * (1 - t) + sorted[hi] * t;
}

export function normaliseAgainstPercentiles(
  value: number,
  cohort: number[],
  direction: Direction,
): number {
  if (cohort.length < 2) {
    // Not enough points to set a useful range. Return a neutral 50
    // so the sub-score doesn't dominate either direction.
    return 50;
  }
  const p25 = quantile(cohort, 0.25);
  const p75 = quantile(cohort, 0.75);
  if (p75 === p25) {
    // All values in the cohort are identical — no spread to normalise
    // against. Return 50.
    return 50;
  }
  if (direction === "higher_is_better") {
    if (value <= p25) return 0;
    if (value >= p75) return 100;
    return Math.round(((value - p25) / (p75 - p25)) * 100);
  }
  // lower_is_better
  if (value <= p25) return 100;
  if (value >= p75) return 0;
  return Math.round((1 - (value - p25) / (p75 - p25)) * 100);
}
