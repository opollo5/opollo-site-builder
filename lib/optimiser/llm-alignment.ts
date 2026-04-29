import "server-only";

import { defaultAnthropicCall, type AnthropicCallFn } from "@/lib/anthropic-call";
import { computeCostCents } from "@/lib/anthropic-pricing";
import { logger } from "@/lib/logger";

import { gateLlmCall, recordLlmCall } from "./llm-usage";
import type { PageSnapshot } from "./page-content-analysis";

// ---------------------------------------------------------------------------
// LLM-augmented sub-scoring for alignment (spec §8 "rules + LLM hybrid").
//
// Slice 5 shipped rules-only. Slice 8 wires the LLM augmentation for the
// two sub-scores that genuinely need semantic judgement:
//
//   1. ad_to_page_match — does the ad's headline + description match
//      the landing page's above-fold content? Token overlap (rules)
//      misses "managed IT services" ≈ "IT support" ≈ "managed IT
//      solutions"; LLM closes the semantic gap.
//
//   2. intent_match — informational vs. transactional vs. navigational
//      classification of the top search terms vs. the page type. The
//      rules pass uses lexical signals ("how to" / "buy"); LLM
//      classifies the corpus as a whole.
//
// Keyword relevance, CTA consistency, and offer clarity stay rules-
// only — the deterministic checks are accurate enough on those and an
// LLM call would burn budget for marginal lift.
//
// Budget enforcement (spec §4.6):
//   - Every call goes through gateLlmCall(clientId, caller).
//   - 75% warn → call still proceeds, dashboard banner reads from
//     checkBudget independently.
//   - 100% block → both sub-scores fall back to rules-only and the
//     confidence_factor's signal sub-factor is multiplied by 0.7 by
//     the caller (lib/optimiser/score-pages-job.ts wires this).
//
// Caching (spec §7.3 — "alignment scores cached per (ad group, page
// version, behaviour-data window)"): the caller checks
// opt_alignment_scores.input_fingerprint against the freshly-computed
// fingerprint. Match → skip scoring entirely, reuse the existing row.
// This keeps Phase 1 LLM cost predictable: one call per (ad group,
// page version) per behaviour window, not one per cron tick.
// ---------------------------------------------------------------------------

const LLM_MODEL = "claude-sonnet-4-6";

export type LlmSubscoreResult = {
  /** 0–100. Always set, even on fallback. */
  score: number;
  /** One-line rationale for the review pane. */
  rationale: string;
  /** TRUE if the value was produced by the LLM; FALSE if budget /
   * error fallback. The caller penalises the confidence signal when
   * source = 'rules_fallback'. */
  source: "llm" | "rules_fallback";
  /** Fallback reason when source = 'rules_fallback'. */
  fallback_reason?: "budget_exceeded" | "llm_error" | "parse_failed";
};

export type LlmAlignmentInputs = {
  clientId: string;
  adGroupId: string;
  landingPageId: string;
  snapshot: PageSnapshot;
  adHeadlines: string[];
  adDescriptions: string[];
  searchTerms: string[];
  /** Rules-derived score the LLM call returned to (for fallback). */
  rulesAdToPageMatch: number;
  rulesIntentMatch: number;
  /** Test injection point — production paths leave undefined. */
  callFn?: AnthropicCallFn;
};

export type LlmAlignmentResult = {
  ad_to_page_match: LlmSubscoreResult;
  intent_match: LlmSubscoreResult;
  /** TRUE if either sub-score fell back to rules. The caller multiplies
   * the alignment confidence's signal sub-factor by 0.7 when this is true. */
  fallback_engaged: boolean;
};

const ADP_SYSTEM = `You are an alignment-scoring assistant for a landing-page optimisation engine.

You score how closely a Google Ads ad's headlines + descriptions match the landing page's above-fold content. Return a JSON object only — no prose, no markdown fences.

Rubric (0–100):
- 90–100: Ad and page convey the same value proposition, audience, and product/service. Wording differs but meaning aligns.
- 70–89: Same domain and audience; some specific claims in the ad aren't reflected on the page.
- 50–69: Same broad category, different specifics. Visitor would feel a noticeable shift.
- 30–49: Mismatched audience or offer specifics. Likely to bounce.
- 0–29: Different product or audience entirely.

Output schema:
{
  "score": <integer 0-100>,
  "rationale": "<one-sentence reason, no quotes>"
}`;

const INTENT_SYSTEM = `You classify search-term intent and assess whether a landing page satisfies it.

Possible intents: "informational" (user wants to learn), "transactional" (user wants to buy / sign up / book), "navigational" (user wants a specific brand or page).

Score 0–100 for how well the page satisfies the dominant intent of the search-term sample.

Rubric:
- 90–100: Intent and page type match cleanly (transactional intent + form-led conversion page; informational intent + content-led page).
- 60–89: Generally aligned, with mismatched secondary signals.
- 30–59: Partial overlap — the page may serve a related but different intent.
- 0–29: Page actively works against the dominant intent.

Output schema:
{
  "score": <integer 0-100>,
  "intent": "informational" | "transactional" | "navigational" | "mixed",
  "rationale": "<one-sentence reason, no quotes>"
}`;

const ADP_INPUT_TEMPLATE = (
  ad_headlines: string[],
  ad_descriptions: string[],
  page: PageSnapshot,
) =>
  `Ad headlines:
${ad_headlines.slice(0, 5).map((h) => `- ${truncate(h, 90)}`).join("\n")}

Ad descriptions:
${ad_descriptions.slice(0, 3).map((d) => `- ${truncate(d, 180)}`).join("\n")}

Landing page:
- Title: ${truncate(page.title ?? "(missing)", 120)}
- H1: ${truncate(page.h1 ?? "(missing)", 120)}
- H2s:
${(page.h2s ?? []).slice(0, 5).map((h) => `  - ${truncate(h, 120)}`).join("\n")}
- Primary CTA: ${truncate(page.primary_cta?.text ?? "(missing)", 80)}
- Hero excerpt: ${truncate(page.hero_excerpt ?? "(missing)", 600)}

Score the ad-to-page match per the rubric. Return JSON only.`;

const INTENT_INPUT_TEMPLATE = (
  search_terms: string[],
  page: PageSnapshot,
) =>
  `Top search terms (sorted by impressions, may be empty):
${(search_terms.length === 0 ? ["(none — no search-term data yet)"] : search_terms.slice(0, 30).map((t) => `- ${truncate(t, 120)}`)).join("\n")}

Landing page:
- Title: ${truncate(page.title ?? "(missing)", 120)}
- H1: ${truncate(page.h1 ?? "(missing)", 120)}
- Primary CTA verb: ${page.primary_cta?.verb ?? "(none)"}
- Has form: ${page.has_form ? "yes" : "no"}
- Form field count: ${page.form_field_count}

Classify the dominant intent of the search-term sample and score how well the page satisfies it. Return JSON only.`;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export async function scoreAlignmentLlm(
  inputs: LlmAlignmentInputs,
): Promise<LlmAlignmentResult> {
  const callFn = inputs.callFn ?? defaultAnthropicCall;
  const gate = await gateLlmCall(inputs.clientId, "alignment_scoring");
  if (gate === "block") {
    // Budget exceeded — return rules-only with a fallback flag.
    return {
      ad_to_page_match: {
        score: inputs.rulesAdToPageMatch,
        rationale: "Budget exhausted — rules-only fallback.",
        source: "rules_fallback",
        fallback_reason: "budget_exceeded",
      },
      intent_match: {
        score: inputs.rulesIntentMatch,
        rationale: "Budget exhausted — rules-only fallback.",
        source: "rules_fallback",
        fallback_reason: "budget_exceeded",
      },
      fallback_engaged: true,
    };
  }

  const [adp, intent] = await Promise.all([
    scoreOne({
      callFn,
      clientId: inputs.clientId,
      caller: "alignment_scoring",
      system: ADP_SYSTEM,
      user: ADP_INPUT_TEMPLATE(
        inputs.adHeadlines,
        inputs.adDescriptions,
        inputs.snapshot,
      ),
      idempotencyKey: `${inputs.adGroupId}:${inputs.landingPageId}:adp:${behaviourBucket()}`,
      sourceTable: "opt_alignment_scores",
      sourceId: undefined,
      rulesScore: inputs.rulesAdToPageMatch,
      expectKeys: ["score", "rationale"],
    }),
    scoreOne({
      callFn,
      clientId: inputs.clientId,
      caller: "alignment_scoring",
      system: INTENT_SYSTEM,
      user: INTENT_INPUT_TEMPLATE(inputs.searchTerms, inputs.snapshot),
      idempotencyKey: `${inputs.adGroupId}:${inputs.landingPageId}:intent:${behaviourBucket()}`,
      sourceTable: "opt_alignment_scores",
      sourceId: undefined,
      rulesScore: inputs.rulesIntentMatch,
      expectKeys: ["score", "rationale"],
    }),
  ]);

  return {
    ad_to_page_match: adp,
    intent_match: intent,
    fallback_engaged:
      adp.source === "rules_fallback" || intent.source === "rules_fallback",
  };
}

/** Behaviour bucket = the 7-day window the rolling metrics are reading
 * from. Same bucket within a week → same idempotency key → Anthropic's
 * server-side cache returns the original response without billing
 * twice. */
function behaviourBucket(): string {
  const now = new Date();
  const start = Date.UTC(2026, 0, 1);
  const week = Math.floor((now.getTime() - start) / (7 * 24 * 60 * 60 * 1000));
  return `w${week}`;
}

type ScoreOneArgs = {
  callFn: AnthropicCallFn;
  clientId: string;
  caller: string;
  system: string;
  user: string;
  idempotencyKey: string;
  sourceTable: string;
  sourceId?: string;
  rulesScore: number;
  expectKeys: string[];
};

async function scoreOne(args: ScoreOneArgs): Promise<LlmSubscoreResult> {
  let response;
  try {
    response = await args.callFn({
      model: LLM_MODEL,
      max_tokens: 200,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
      idempotency_key: args.idempotencyKey,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("optimiser.llm_alignment.call_failed", {
      client_id: args.clientId,
      caller: args.caller,
      error: message,
    });
    await recordLlmCall({
      clientId: args.clientId,
      caller: args.caller,
      model: LLM_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicros: 0,
      outcome: "error",
      errorCode: "LLM_ERROR",
    });
    return {
      score: args.rulesScore,
      rationale: "LLM call failed — rules-only fallback.",
      source: "rules_fallback",
      fallback_reason: "llm_error",
    };
  }

  const { cents } = computeCostCents(response.model, response.usage);
  await recordLlmCall({
    clientId: args.clientId,
    caller: args.caller,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedTokens: response.usage.cache_read_input_tokens ?? 0,
    costUsdMicros: cents * 10_000, // cents → micros
    anthropicRequestId: response.id,
    sourceTable: args.sourceTable,
    sourceId: args.sourceId,
  });

  const text = response.content.map((b) => b.text).join("\n").trim();
  const parsed = parseJsonResponse(text);
  if (!parsed || !args.expectKeys.every((k) => k in parsed)) {
    logger.warn("optimiser.llm_alignment.parse_failed", {
      client_id: args.clientId,
      caller: args.caller,
      response_id: response.id,
      raw: text.slice(0, 200),
    });
    return {
      score: args.rulesScore,
      rationale: "LLM response could not be parsed — rules-only fallback.",
      source: "rules_fallback",
      fallback_reason: "parse_failed",
    };
  }

  const score = clampScore(parsed.score);
  const rationale =
    typeof parsed.rationale === "string"
      ? parsed.rationale.slice(0, 280)
      : "(no rationale)";
  return {
    score,
    rationale,
    source: "llm",
  };
}

function parseJsonResponse(text: string): Record<string, unknown> | null {
  // Strip optional markdown fences.
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // try to find the first {...} block.
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (typeof parsed === "object" && parsed !== null) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through
      }
    }
  }
  return null;
}

function clampScore(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}
