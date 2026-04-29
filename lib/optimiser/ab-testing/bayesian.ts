// Bayesian winner detection for the §6 feature 8 A/B test monitor.
//
// Model: each variant's true conversion rate is a Beta distribution
// with prior Beta(1, 1) (uniform — no a-priori belief). Posterior after
// observing `c` conversions out of `s` sessions is Beta(1 + c, 1 + s - c).
//
// We want P(theta_b > theta_a) — the probability variant B's true CR
// is higher than A's. Closed-form integration is awkward; use Monte
// Carlo with a large fixed-seed sample. 100k draws gives ~0.001
// uncertainty on the probability estimate, which is well below the
// 95% decision threshold.
//
// The §12.3 minimum-sample floors (≥ 100 sessions and ≥ 10 conversions
// per variant) are enforced by the caller — this module's job is just
// to compute the probability. If sample sizes are below that floor,
// the caller skips the call entirely.
//
// Pure module — no DB / network access. Easy to test.

const SAMPLE_COUNT = 100_000;

export interface VariantOutcome {
  sessions: number;
  conversions: number;
}

export interface BayesianResult {
  /** P(B > A) — probability variant B is the better version. */
  probability_b_better: number;
  /** P(A > B) — complementary. Always equals 1 - probability_b_better
   *  ignoring the (negligible) chance of a tie at the sample resolution. */
  probability_a_better: number;
  /** Posterior mean CR for each variant. */
  posterior_mean_a: number;
  posterior_mean_b: number;
  /** Posterior 95% credible interval for each variant. */
  ci_95_a: [number, number];
  ci_95_b: [number, number];
  /** Effective sample sizes. */
  sessions_a: number;
  sessions_b: number;
  conversions_a: number;
  conversions_b: number;
}

/**
 * Compute the Bayesian winner probability and posterior credible
 * intervals for an A/B test.
 *
 * Deterministic with a fixed PRNG seed so the same inputs produce the
 * same outputs across runs — the monitor cron stores the latest
 * probability on opt_tests, and we want re-evaluations to be stable
 * for any given (sessions_a, conversions_a, sessions_b, conversions_b)
 * tuple.
 */
export function computeWinnerProbability(
  a: VariantOutcome,
  b: VariantOutcome,
): BayesianResult {
  // Beta(alpha, beta) with prior Beta(1, 1) — uniform.
  const alphaA = 1 + a.conversions;
  const betaA = 1 + Math.max(0, a.sessions - a.conversions);
  const alphaB = 1 + b.conversions;
  const betaB = 1 + Math.max(0, b.sessions - b.conversions);

  // Deterministic PRNG keyed off the inputs so the result is
  // reproducible. Slightly slower than native Math.random but
  // necessary for stable monitor outputs.
  const seed = hashInputs(a, b);
  const rng = mulberry32(seed);

  const samplesA = sampleBeta(alphaA, betaA, SAMPLE_COUNT, rng);
  const samplesB = sampleBeta(alphaB, betaB, SAMPLE_COUNT, rng);

  let bWins = 0;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    if (samplesB[i] > samplesA[i]) bWins += 1;
  }
  const pB = bWins / SAMPLE_COUNT;

  return {
    probability_b_better: round3(pB),
    probability_a_better: round3(1 - pB),
    posterior_mean_a: round3(alphaA / (alphaA + betaA)),
    posterior_mean_b: round3(alphaB / (alphaB + betaB)),
    ci_95_a: ci95(samplesA),
    ci_95_b: ci95(samplesB),
    sessions_a: a.sessions,
    sessions_b: b.sessions,
    conversions_a: a.conversions,
    conversions_b: b.conversions,
  };
}

function ci95(samples: number[]): [number, number] {
  const sorted = [...samples].sort((x, y) => x - y);
  const lo = sorted[Math.floor(0.025 * sorted.length)];
  const hi = sorted[Math.floor(0.975 * sorted.length)];
  return [round3(lo), round3(hi)];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function hashInputs(a: VariantOutcome, b: VariantOutcome): number {
  let h = 2166136261 >>> 0;
  for (const x of [a.sessions, a.conversions, b.sessions, b.conversions]) {
    h ^= x;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// Mulberry32 PRNG — 32-bit, fast, deterministic given a seed.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sample n draws from Beta(alpha, beta) using the gamma-ratio method:
 *   X ~ Gamma(alpha, 1), Y ~ Gamma(beta, 1) → Beta = X / (X + Y).
 *
 * Gamma sampling via Marsaglia-Tsang for shape ≥ 1; for shape < 1
 * (rare here since alpha = 1 + conversions ≥ 1 in our usage) we fall
 * back to a boost-shift method. The §12.3 floors guarantee alpha ≥
 * 11 in practice (10 conversions + prior of 1), so the shape-≥-1
 * path is the hot path.
 */
function sampleBeta(
  alpha: number,
  beta: number,
  n: number,
  rng: () => number,
): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const x = sampleGamma(alpha, rng);
    const y = sampleGamma(beta, rng);
    out[i] = x / (x + y);
  }
  return out;
}

function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    // Boost shift: draw from Gamma(shape + 1) and scale by U^(1/shape).
    const g = sampleGamma(shape + 1, rng);
    return g * Math.pow(rng(), 1 / shape);
  }
  // Marsaglia-Tsang.
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const xNorm = sampleStandardNormal(rng);
    const v = (1 + c * xNorm) ** 3;
    if (v <= 0) continue;
    const u = rng();
    const xSq = xNorm * xNorm;
    if (u < 1 - 0.0331 * xSq * xSq) return d * v;
    if (Math.log(u) < 0.5 * xSq + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleStandardNormal(rng: () => number): number {
  // Box-Muller. Two uniforms → two normals; cache the second.
  // Simplest stateful implementation rebuilt per call to keep this
  // pure-function-ish — slight wasted draw but fine for our volumes.
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
