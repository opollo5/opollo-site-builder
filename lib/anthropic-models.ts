// ---------------------------------------------------------------------------
// Anthropic model registry — single source of truth for the operator-
// facing model picker + the default tier.
//
// UAT-smoke-1 — moved out of components/BriefReviewClient.tsx so the
// list lives next to the pricing table (lib/anthropic-pricing.ts) and
// the freshness procedure (docs/RUNBOOK.md → "Anthropic releases a
// new model"). Adding a new model means updating THREE files in the
// same PR:
//   1. lib/anthropic-pricing.ts  — PRICING_TABLE entry (rates).
//   2. lib/anthropic-models.ts   — this file (UI label + tier).
//   3. supabase/migrations/00NN_models_*.sql — extend the
//      briefs.text_model / briefs.visual_model CHECK constraints.
//
// Tier defaults to 'haiku' for development / UAT / cheap-by-default
// runs (~5× cheaper than Sonnet). Operators opt INTO Sonnet or Opus
// when they need higher quality.
// ---------------------------------------------------------------------------

import { ANTHROPIC_MODEL_ALLOWLIST } from "@/lib/anthropic-pricing";

export type ModelTier = "haiku" | "sonnet" | "opus";

export type ModelOption = {
  /** Wire id matching the PRICING_TABLE key in lib/anthropic-pricing.ts. */
  value: string;
  /** Operator-facing label rendered in the picker. */
  label: string;
  /** Operator-facing hint/tooltip. */
  hint: string;
  /** Tier classification — drives default selection + sorting. */
  tier: ModelTier;
};

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = Object.freeze([
  {
    value: "claude-haiku-4-5-20251001",
    label: "Haiku (fastest, cheapest)",
    hint: "Use for dev / UAT smoke-test runs. ~5× cheaper than Sonnet but produces noticeably thinner copy and flatter layouts on real briefs.",
    tier: "haiku",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Sonnet (balanced — default)",
    hint: "Default for production briefs. Best ratio of quality to cost; substantially richer first-pass output than Haiku.",
    tier: "sonnet",
  },
  {
    value: "claude-opus-4-7",
    label: "Opus (highest quality, most expensive)",
    hint: "Reserve for complex-judgment briefs. ~5× the cost of Sonnet.",
    tier: "opus",
  },
]);

/**
 * Default model id for fresh brief runs. Sonnet 4.6 — UAT (2026-05-02)
 * surfaced that Haiku output reads as generic / flat in real-use briefs.
 * Operators opt DOWN to Haiku per-brief for cheap dev/test runs via the
 * review-screen picker.
 */
export const DEFAULT_MODEL_ID = "claude-sonnet-4-6";

// Defense-in-depth: every option in this UI list must be in the
// allowlist exported by lib/anthropic-pricing.ts. A drift between the
// two lists would mean the picker offers a model the runner refuses.
// Caught at module-load time so the build fails noisily rather than
// shipping a broken picker. The check runs once per process.
{
  const driftedOptions = MODEL_OPTIONS.filter(
    (o) => !ANTHROPIC_MODEL_ALLOWLIST.includes(o.value),
  );
  if (driftedOptions.length > 0) {
    throw new Error(
      `lib/anthropic-models.ts: MODEL_OPTIONS drift — ${driftedOptions
        .map((o) => o.value)
        .join(
          ", ",
        )} not in ANTHROPIC_MODEL_ALLOWLIST. Add to lib/anthropic-pricing.ts:PRICING_TABLE before the option appears in the picker.`,
    );
  }
}
