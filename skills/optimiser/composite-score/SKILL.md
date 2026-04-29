# Skill — composite-score

Assemble the v1.6 composite Landing Page Score per addendum §2.1 + §2.4.

## Formula
```
composite = (alignment × w_a) + (behaviour × w_b) + (conversion × w_c) + (technical × w_t)
```

Default weights: `{alignment: 0.25, behaviour: 0.30, conversion: 0.30, technical: 0.15}`. Per-client overrides in `opt_clients.score_weights` (read-only in Phase 1, editable in Phase 2 once calibration data flows).

## Classification (§2.3)
- 80–100 → `high_performer`  (green)
- 60–79  → `optimisable`    (amber)
-  0–59  → `needs_attention` (red)

## Edge cases

### conversion_n_a = TRUE (§2.4)
Awareness-stage pages without a conversion goal. Conversion's 0.30 weight redistributes equally across alignment / behaviour / technical (each gains 0.10).

### Missing sub-score input
If a sub-score is NULL (insufficient data, no PSI run yet, no ad group join for alignment), its weight is dropped and the remaining weights rescale to sum to 1. The result still produces a valid composite as long as at least one sub-score is available.

### Both
When conversion_n_a + alignment is NULL, the remaining weight (now spread across behaviour + technical with redistributed conversion bumps) rescales again. The `redistribution_applied: true` flag is set so the UI can show the "weights redistributed" hint.

## Output
```ts
{
  composite_score: 0..100,
  classification: "high_performer" | "optimisable" | "needs_attention",
  weights_used: { ... },        // post-redistribution
  redistribution_applied: bool,
  contributions: { ... },       // subscore × weight per axis
}
```

## "What's dragging this score down" hint (§4.1)
`lowestContribution(result)` returns the sub-score with the smallest weighted contribution among non-zero-weight sub-scores. NULL when classification is `high_performer`. The page detail panel uses this to point at two relevant playbooks.

## Persistence
The score-evaluator cron (`/api/cron/optimiser-evaluate-scores`) writes:
- `opt_landing_pages.current_composite_score` + `current_classification` (cached for the page browser)
- One row in `opt_page_score_history` per evaluation, with `weights_used` snapshotted so the timeline reflects the truth even after weights change

## Pointers
- `lib/optimiser/scoring/composite-score.ts:computeCompositeScore`
- `lib/optimiser/scoring/composite-score.ts:lowestContribution`
- `lib/optimiser/scoring/classify.ts`
- Caller: `lib/optimiser/scoring/evaluate-scores-job.ts`
