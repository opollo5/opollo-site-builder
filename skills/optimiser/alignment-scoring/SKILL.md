# Skill — alignment-scoring

Score the alignment between an ad group's keywords + ad copy and a landing page (spec §8). Outputs a 0–100 composite plus five sub-scores.

## Inputs
- `PageSnapshot` (from `page-content-analysis`)
- `keywords[]`, `ad_headlines[]`, `ad_descriptions[]` from the ad group
- Optional `search_terms[]` for intent classification

## Sub-scores
1. **keyword_relevance** — top 5 keywords' tokens vs. tokens in (H1, H2s, primary CTA). `hits / 5 × 100`.
2. **ad_to_page_match** — ad headline + description tokens vs. (H1, H2s, hero excerpt). Set overlap × 1.4, capped at 1.0.
3. **cta_consistency** — page CTA verb vs. ad CTA verb. Match = 100; both are conversion verbs but differ = 50; differ + non-conversion = 25.
4. **offer_clarity** — heuristic detection of "offer-shaped phrase" above the fold + CTA above the fold. Both = 90; CTA only = 65; offer only = 50; neither = 25.
5. **intent_match** — informational vs. transactional classification of search-term sample (or unknown) vs. page transactional signals (form + transactional CTA verb).

## Composite
Weighted: keyword_relevance ×0.25, ad_to_page_match ×0.25, cta_consistency ×0.15, offer_clarity ×0.20, intent_match ×0.15.

## Phase 1 = rules-only
Phase 1 ships deterministic rules-only scoring. The spec calls for "rules + LLM hybrid"; the LLM augmentation pass for `keyword_relevance` (semantic equivalence — "managed IT" ≈ "IT support"), `ad_to_page_match` (semantic gap detection), and `intent_match` (LLM classification of search-term intent) is gated on `lib/optimiser/llm-usage.ts:gateLlmCall` and lands as a follow-up. The deterministic baseline is reproducible and lets Phase 1 generate proposals on high-signal cases without LLM cost.

## Output persisted on `opt_alignment_scores`
Composite + 5 subscores + `rationale` (per-subscore notes) + `input_fingerprint` (cache key for skip-recompute). UPSERT on `(ad_group_id, landing_page_id)`.

## Spec
§8, Table 17.

## Pointers
- `lib/optimiser/alignment-scoring.ts:scoreAlignment`
- Caller: `lib/optimiser/score-pages-job.ts`
