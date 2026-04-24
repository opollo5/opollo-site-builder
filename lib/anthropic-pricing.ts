// ---------------------------------------------------------------------------
// M3-4 — Anthropic pricing table + cost helper.
//
// Intentionally in code, not in the DB. Pricing changes rarely, and we
// want the rates tied to the code version that priced the request — a
// DB table would risk retroactively re-pricing already-billed rows
// when the row is updated. If rates change, bump the version string
// below and log it into generation_events so the audit trail records
// which table was in effect.
//
// Units: costs are stored in micro-cents (1 USD = 100 cents = 100,000
// micro-cents). Token counts × rate = micro-cents of cost. Convert to
// integer cents at the slot-write boundary with Math.ceil — we'd
// rather overstate by 1 cent than understate.
// ---------------------------------------------------------------------------

export const PRICING_VERSION = "2026-04-v1";

/**
 * Rate units: micro-cents per token. 1 cent = 100 micro-cents.
 * e.g. Claude Opus 4.7 input = $15.00 per 1M tokens
 *   = 1500 cents per 1M tokens = 1_500_000 micro-cents per 1M tokens
 *   = 1.5 micro-cents per token.
 */
type Pricing = {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
};

// Rates sourced from Anthropic's pricing page as of 2026-04. Add new
// models here as we onboard them; don't mutate existing entries.
// Units: micro-cents per token (see header comment above).
const PRICING_TABLE: Record<string, Pricing> = {
  "claude-opus-4-7": {
    input: 1.5,
    output: 7.5,
    cache_write: 1.875,
    cache_read: 0.15,
  },
  "claude-sonnet-4-6": {
    input: 0.3,
    output: 1.5,
    cache_write: 0.375,
    cache_read: 0.03,
  },
  "claude-haiku-4-5-20251001": {
    input: 0.08,
    output: 0.4,
    cache_write: 0.1,
    cache_read: 0.008,
  },
};

/**
 * M12-4 Risk #14 — single source of truth for models the runner is
 * allowed to invoke. Matches the CHECK constraint on briefs.text_model /
 * briefs.visual_model in migration 0020. Derived from PRICING_TABLE so
 * an unpriced model can never be allow-listed.
 */
export const ANTHROPIC_MODEL_ALLOWLIST: ReadonlyArray<string> = Object.freeze(
  Object.keys(PRICING_TABLE),
);

/**
 * True if the given model id is allow-listed for runner invocation.
 * Runner calls this at pass-start; an unknown value → page fails with
 * INVALID_MODEL without firing any Anthropic call.
 */
export function isAllowedAnthropicModel(model: string): boolean {
  return ANTHROPIC_MODEL_ALLOWLIST.includes(model);
}

/**
 * M12-4 Risk #15 — approximate cost per page for the pre-flight
 * estimator. Empirical-ish ballpark from M12-3 runs (text-only):
 * a standard page runs ~40k input tokens (cached) + ~15k output tokens
 * across the three text passes; the visual critique adds ~5k input +
 * ~500 output + 2× 500KB images (roughly 6500 image tokens each).
 * Anchor pages run 2 extra revises. Constants are conservative upper
 * bounds; actuals tend lower once prompt-caching amortises.
 *
 * Exported so tests can pin the inputs.
 */
export type BriefRunEstimateInputs = {
  text_model: string;
  visual_model: string;
  page_count: number;
  anchor_present: boolean;
};

const TEXT_INPUT_TOKENS_PER_PAGE = 40_000;
const TEXT_OUTPUT_TOKENS_PER_PAGE = 15_000;
const TEXT_ANCHOR_EXTRA_INPUT = 20_000;
const TEXT_ANCHOR_EXTRA_OUTPUT = 8_000;
const VISUAL_INPUT_TOKENS_PER_ITERATION = 5_000;
const VISUAL_OUTPUT_TOKENS_PER_ITERATION = 500;
const VISUAL_IMAGE_TOKENS_PER_ITERATION = 13_000; // 2× 500KB PNGs ≈ ~6.5k tokens each
const VISUAL_ITERATIONS_PER_PAGE = 2; // conservative — assumes max iterations fire

export function estimatePerPageCostCents(
  textModel: string,
  visualModel: string,
  includeAnchor: boolean,
): number {
  const textRates = PRICING_TABLE[textModel];
  const visualRates = PRICING_TABLE[visualModel];
  if (!textRates || !visualRates) return 0;

  const textInput = includeAnchor
    ? TEXT_INPUT_TOKENS_PER_PAGE + TEXT_ANCHOR_EXTRA_INPUT
    : TEXT_INPUT_TOKENS_PER_PAGE;
  const textOutput = includeAnchor
    ? TEXT_OUTPUT_TOKENS_PER_PAGE + TEXT_ANCHOR_EXTRA_OUTPUT
    : TEXT_OUTPUT_TOKENS_PER_PAGE;

  const textMicroCents = textInput * textRates.input + textOutput * textRates.output;

  const visualInput =
    (VISUAL_INPUT_TOKENS_PER_ITERATION + VISUAL_IMAGE_TOKENS_PER_ITERATION) *
    VISUAL_ITERATIONS_PER_PAGE;
  const visualOutput =
    VISUAL_OUTPUT_TOKENS_PER_ITERATION * VISUAL_ITERATIONS_PER_PAGE;

  const visualMicroCents =
    visualInput * visualRates.input + visualOutput * visualRates.output;

  // Unit math: microCents → cents via /1000 (1 cent = 1000 micro-cents),
  // matching computeCostCents in this file.
  return Math.ceil((textMicroCents + visualMicroCents) / 1000);
}

/**
 * Pre-flight cost estimate for a brief run. Returns the total estimated
 * cents — caller compares against remaining tenant budget to decide
 * whether to prompt for confirmation.
 */
export function estimateBriefRunCostCents(inputs: BriefRunEstimateInputs): number {
  if (inputs.page_count <= 0) return 0;
  const anchorCost = inputs.anchor_present
    ? estimatePerPageCostCents(inputs.text_model, inputs.visual_model, true)
    : 0;
  const nonAnchorCount =
    inputs.page_count - (inputs.anchor_present ? 1 : 0);
  const nonAnchorCost =
    nonAnchorCount > 0
      ? nonAnchorCount *
        estimatePerPageCostCents(inputs.text_model, inputs.visual_model, false)
      : 0;
  return anchorCost + nonAnchorCost;
}

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

/**
 * Compute the USD cost for a given usage block, in integer cents.
 * Returns 0 if the model is unknown — we log that at the call site so
 * an operator can add the rates, but we never throw; a missing rate
 * is a reporting bug, not a reason to reject the response we already
 * paid for.
 */
export function computeCostCents(
  model: string,
  usage: TokenUsage,
): { cents: number; rateFound: boolean } {
  const rates = PRICING_TABLE[model];
  if (!rates) return { cents: 0, rateFound: false };

  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  const microCentsPerToken = {
    input: rates.input,
    output: rates.output,
    cache_write: rates.cache_write,
    cache_read: rates.cache_read,
  };

  const microCents =
    usage.input_tokens * microCentsPerToken.input +
    usage.output_tokens * microCentsPerToken.output +
    cacheWrite * microCentsPerToken.cache_write +
    cacheRead * microCentsPerToken.cache_read;

  // microCents → cents: divide by 1000 (1 cent = 1000 micro-cents).
  // Round up — we'd rather pay a rounding cent to the operator's budget
  // than undercount the spend.
  return { cents: Math.ceil(microCents / 1000), rateFound: true };
}

export function hasPricing(model: string): boolean {
  return model in PRICING_TABLE;
}
