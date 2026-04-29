# Skill — behaviour-subscore

Compute the v1.6 Behaviour sub-score per addendum §2.2.2.

## Inputs
- `PageMetricsRollup` (30-day rollup from `lib/optimiser/metrics-aggregation.ts`)
- `BehaviourCohortRow[]` — same-shape rollups for the client's other active pages, used as the percentile baseline
- Optional `cta_clicks_per_session` (Phase 2 wires the Clarity click-map data; Phase 1 leaves it unset → component dropped from the weighted sum)

## Components + weights (Table 1 of the addendum)
| Component | Weight | Direction | Source |
|---|---|---|---|
| Bounce rate | 0.30 | lower is better | GA4 |
| Avg engagement time | 0.25 | higher is better | GA4 |
| Scroll depth (avg %) | 0.25 | higher is better | Clarity |
| CTA clicks per session | 0.20 | higher is better | Clarity click maps / GA4 events |

## Normalisation
Each component is normalised to 0–100 against the client's active-pages 25th–75th percentile range. Why per-client: a B2B page with 90s engagement isn't penalised against a B2C page with 15s engagement. Why p25/p75: it ignores extreme outliers that would otherwise stretch the scale.

When a cohort has < 2 pages, the helper returns `50` (neutral). When all cohort values are identical, also `50`.

## Missing-component redistribution
If a component's input is unavailable for the page (e.g. no Clarity data), that component's weight redistributes proportionally across the available components. The sub-score returns NULL only when all four inputs are missing.

## Output
```ts
{ score: 0..100, components: { ... }, components_used: 1..4 }
```

## Pointers
- `lib/optimiser/scoring/behaviour-subscore.ts:computeBehaviourSubscore`
- `lib/optimiser/scoring/percentile.ts:normaliseAgainstPercentiles`
- Caller: `lib/optimiser/scoring/evaluate-scores-job.ts`
