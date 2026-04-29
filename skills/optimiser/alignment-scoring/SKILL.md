# Skill — alignment-scoring

Score the alignment between an ad group's keywords + ad copy and a landing page (spec §8). Outputs a 0–100 composite plus five sub-scores.

## Inputs
- `PageSnapshot` (from `page-content-analysis`)
- `keywords[]`, `ad_headlines[]`, `ad_descriptions[]` from the ad group
- Optional `search_terms[]` for intent classification (Slice 7+ writes top 30 per ad group into `opt_ad_groups.raw.top_search_terms`)

## Sub-scores
1. **keyword_relevance** — top 5 keywords' tokens vs. tokens in (H1, H2s, primary CTA). `hits / 5 × 100`. _Rules-based._
2. **ad_to_page_match** — ad headline + description tokens vs. (H1, H2s, hero excerpt). _Rules + LLM hybrid (Slice 8)._
3. **cta_consistency** — page CTA verb vs. ad CTA verb. _Rules-based._
4. **offer_clarity** — heuristic detection of "offer-shaped phrase" above the fold + CTA above the fold. _Rules-based._
5. **intent_match** — informational / transactional / navigational classification of the search-term sample vs. page transactional signals. _Rules + LLM hybrid (Slice 8)._

## Composite
Weighted: keyword_relevance ×0.25, ad_to_page_match ×0.25, cta_consistency ×0.15, offer_clarity ×0.20, intent_match ×0.15.

## LLM hybrid (Slice 8)
The two sub-scores that need semantic judgement (`ad_to_page_match`, `intent_match`) call `claude-sonnet-4-6` via `lib/anthropic-call.ts`. The other three stay rules-only because deterministic checks are accurate enough on those.

**Budget gate (§4.6).** Every call goes through `gateLlmCall(clientId, "alignment_scoring")` from `lib/optimiser/llm-usage.ts`. On `block` (100% of monthly budget consumed), both LLM sub-scores fall back to the rules-derived values, the result carries `fallback_engaged: true`, and the caller in `score-pages-job.ts` multiplies the playbook trigger magnitude by 0.7 — so the resulting proposal's confidence signal sub-factor is penalised, reflecting the lower-quality scoring.

**Caching (§7.3).** Score-pages-job checks `opt_alignment_scores` for an existing row by `(ad_group_id, landing_page_id)`. If `input_fingerprint` matches the freshly-computed fingerprint AND `computed_at` is < 24h old, the cached row is reused and no LLM call is made. Anthropic's server-side idempotency cache (24h) absorbs any same-bucket re-runs that slip through; the `idempotency_key` carries `<ad_group>:<page>:<subscore>:w<iso_week>`.

**LLM error fallback.** On HTTP error or unparseable response, the affected sub-score falls back to the rules-derived value with `source: 'rules_fallback'` and the fallback flag propagates into the confidence penalty as above.

## Cost recording
Every LLM call writes one `opt_llm_usage` row with:
- `caller: 'alignment_scoring'`
- `model: 'claude-sonnet-4-6'` (resolved from the response, not the request — handles model upgrades cleanly)
- `cost_usd_micros` from `lib/anthropic-pricing.ts:computeCostCents`
- `outcome: 'ok' | 'error' | 'budget_exceeded'`

Pre-call rejections (budget exhausted) write a single `outcome='budget_exceeded'` row per scoring pass so the dashboard surface can show "what would have been spent."

## Output persisted on `opt_alignment_scores`
Composite + 5 subscores + `rationale` (per-subscore notes — including LLM rationale for ad_to_page_match and intent_match) + `input_fingerprint` (cache key for skip-recompute). UPSERT on `(ad_group_id, landing_page_id)`.

## Spec
§8, Table 17.

## Pointers
- `lib/optimiser/alignment-scoring.ts:scoreAlignment` (rules pass)
- `lib/optimiser/llm-alignment.ts:scoreAlignmentLlm` (LLM hybrid pass)
- Caller: `lib/optimiser/score-pages-job.ts`
