import "server-only";

import type { OptRiskLevel } from "./types";

// ---------------------------------------------------------------------------
// Guardrails (spec §10).
//
// Phase 1 enforcement is at proposal-approve time. Slice 6 lints every
// approval through this function; failures block approval with a
// GUARDRAIL_FAILED error so staff can see WHY the proposal was
// rejected, fix the change_set, and re-approve.
//
// The §10 invariants:
//   1. Never invent claims. New factual claims (statistics, certifications,
//      case study figures) must be high-risk + carry a source citation.
//   2. Never fabricate testimonials. Only existing testimonials.
//   3. Never change core_offer without high-risk approval.
//   4. Never break design rules. (Site Builder generation engine
//      enforcement; we lint the brief shape here.)
//
// Phase 1.5: enforcement at brief construction (Site Builder side).
// Slice 6 ships the lint catch *before* brief submission so
// guardrail-failing proposals never reach the Site Builder.
// ---------------------------------------------------------------------------

export type GuardrailResult = {
  ok: boolean;
  failures: string[];
  warnings: string[];
};

export type LintInputs = {
  change_set: Record<string, unknown>;
  before_snapshot: Record<string, unknown>;
  risk_level: OptRiskLevel;
  /** Optional core_offer text from opt_landing_pages — when present, we
   * forbid changes that mutate it without high-risk approval. */
  core_offer?: string | null;
};

const FACTUAL_CLAIM_PATTERNS = [
  /\b\d+\s*(years?|customers?|clients?|installs?|downloads?|sites?|projects?)\b/i,
  /\bcertified\b/i,
  /\baccredit/i,
  /\biso\s?9001\b/i,
  /\bsoc\s?2\b/i,
  /\bgdpr\b/i,
  /\bhipaa\b/i,
  /\b#1\b/i,
  /\bbest[- ]rated\b/i,
];

const TESTIMONIAL_PATTERNS = [
  /["“'][^"”']{8,}["”']/, // long quoted text
  /\btestimonial\b/i,
  /\breview\s+by\b/i,
];

export function lintChangeSet(inputs: LintInputs): GuardrailResult {
  const failures: string[] = [];
  const warnings: string[] = [];

  const changeSetText = JSON.stringify(inputs.change_set ?? {}, null, 2);
  const beforeText = JSON.stringify(inputs.before_snapshot ?? {}, null, 2);

  // 1. Invented factual claims.
  for (const pattern of FACTUAL_CLAIM_PATTERNS) {
    const matchInChange = changeSetText.match(pattern);
    if (matchInChange) {
      const inBefore = beforeText.match(pattern);
      if (!inBefore) {
        if (inputs.risk_level === "high") {
          warnings.push(
            `New factual claim '${matchInChange[0]}' present — high-risk approval required + source citation`,
          );
        } else {
          failures.push(
            `New factual claim '${matchInChange[0]}' would be introduced; mark as high-risk + cite source before approving`,
          );
        }
      }
    }
  }

  // 2. Fabricated testimonials.
  for (const pattern of TESTIMONIAL_PATTERNS) {
    const matchInChange = changeSetText.match(pattern);
    if (matchInChange) {
      const inBefore = beforeText.match(pattern);
      if (!inBefore) {
        failures.push(
          `Change introduces testimonial-shaped content not present in before_snapshot. Testimonials must come from the page's existing testimonial collection or be added through a separate approval flow.`,
        );
      }
    }
  }

  // 3. Core offer changes.
  if (inputs.core_offer) {
    if (
      changeSetText.toLowerCase().includes("core_offer") &&
      inputs.risk_level !== "high"
    ) {
      failures.push(
        `Change set references core_offer; risk_level must be 'high' to approve`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
  };
}
