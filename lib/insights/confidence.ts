export interface ConfidenceInput {
  postsInWindow: number;
  postsFromLast30d: number;
  postsFromLast60d: number;
  coefficientOfVariation: number;
  effectMagnitude: number;
}

export interface ConfidenceResult {
  sampleFactor: number;
  freshnessFactor: number;
  stabilityFactor: number;
  signalFactor: number;
  score: number;
  band: "strong" | "moderate" | "below_floor";
}

export const MIN_POSTS_FOR_RECOMMENDATION = 20;

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  if (input.postsInWindow < MIN_POSTS_FOR_RECOMMENDATION) {
    return {
      sampleFactor: 0,
      freshnessFactor: 0,
      stabilityFactor: 0,
      signalFactor: 0,
      score: 0,
      band: "below_floor",
    };
  }

  const sampleFactor = Math.min(1, input.postsInWindow / 100);

  // 1.0 if ≥60% from last 30d, linear decay to 0.5 by day 60
  const freshness30d = input.postsFromLast30d / input.postsInWindow;
  let freshnessFactor: number;
  if (freshness30d >= 0.6) {
    freshnessFactor = 1.0;
  } else {
    const freshness60d = input.postsFromLast60d / input.postsInWindow;
    freshnessFactor = Math.max(0.5, 0.5 + freshness60d * 0.5);
  }

  const stabilityFactor = Math.max(0, Math.min(1, 1 - input.coefficientOfVariation));
  const signalFactor = Math.max(0, Math.min(1, input.effectMagnitude));
  const score = sampleFactor * freshnessFactor * stabilityFactor * signalFactor;

  let band: "strong" | "moderate" | "below_floor";
  if (score >= 0.75) band = "strong";
  else if (score >= 0.45) band = "moderate";
  else band = "below_floor";

  return { sampleFactor, freshnessFactor, stabilityFactor, signalFactor, score, band };
}

export function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance) / mean;
}
