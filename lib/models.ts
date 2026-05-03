/**
 * lib/models.ts
 *
 * Single source of truth for Claude model selection.
 * Every Anthropic call in the codebase imports from here.
 * No model name strings exist anywhere else — enforced by ESLint rule.
 *
 * Model selection rationale:
 * - Site planning (Pass 0+1): Sonnet. One call per site. Most critical.
 *   Wrong here = wrong on every downstream page. Worth the cost.
 * - Page generation (Pass 2): Haiku. Structured JSON from a tight schema.
 *   Haiku handles constrained JSON generation reliably at ~10x less cost.
 * - All other LLM work: Haiku. Critique and revise of structured data
 *   does not require Sonnet-level reasoning.
 * - Validation: no model. Pure TypeScript. Free.
 * - Rendering: no model. Pure function. Free.
 */

export const MODELS = {
  /**
   * Site planning pass (Pass 0+1).
   * Generates the SitePlan: route plan, nav, CTAs, shared content.
   * ONE call per site. Uses Sonnet because this is the anchor for everything.
   */
  SITE_PLANNER: 'claude-sonnet-4-6',

  /**
   * Page document generation (Pass 2).
   * Generates PageDocument JSON from a constrained component schema.
   * ONE call per page. Uses Haiku because the task is structured JSON
   * generation with explicit schema constraints — not open-ended writing.
   */
  PAGE_GENERATOR: 'claude-haiku-4-5-20251001',

  /**
   * Self-critique pass inside page generation.
   * Reviews the PageDocument against explicit copy-quality rules.
   * Uses Haiku — critiquing structured data against rules does not
   * require creative reasoning.
   */
  PAGE_CRITIQUE: 'claude-haiku-4-5-20251001',

  /**
   * Revise pass inside page generation.
   * Applies the critique to produce the final PageDocument.
   * Uses Haiku — constrained edit of structured data.
   */
  PAGE_REVISE: 'claude-haiku-4-5-20251001',

  /**
   * Operator-triggered single section regeneration.
   * Rewrites one section in the context of the surrounding page.
   * Uses Haiku — small, constrained task.
   */
  SECTION_REGEN: 'claude-haiku-4-5-20251001',
} as const;

export type ModelKey = keyof typeof MODELS;
export type ModelValue = (typeof MODELS)[ModelKey];

/**
 * Allowlist for validation. Any model value not in this set is rejected
 * at worker startup with INVALID_MODEL error.
 */
export const MODEL_ALLOWLIST = new Set<string>(Object.values(MODELS));
