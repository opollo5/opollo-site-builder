import {
  ANTHROPIC_INPUT_COST_PER_M,
  ANTHROPIC_OUTPUT_COST_PER_M,
  IDEOGRAM_COST_PER_IMAGE,
} from "@/lib/cap/pricing";

/** Calculates estimated USD cost for an Anthropic call. */
export function calculateAnthropicCost(
  _model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const inputCost = (inputTokens / 1_000_000) * ANTHROPIC_INPUT_COST_PER_M;
  const outputCost = (outputTokens / 1_000_000) * ANTHROPIC_OUTPUT_COST_PER_M;
  return inputCost + outputCost;
}

/** Returns flat per-image USD cost for Ideogram. */
export function calculateIdeogramCost(): number {
  return IDEOGRAM_COST_PER_IMAGE;
}
