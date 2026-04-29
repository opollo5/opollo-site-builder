# Skill — conversion-subscore

Compute the v1.6 Conversion sub-score per addendum §2.2.3.

## Inputs
- `PageMetricsRollup` (rollup gives CR + spend; CPA is computed by the caller as `spend / conversions`)
- `ConversionCohortRow[]` — client's active-pages CR / CPA / revenue values for percentile normalisation
- `ConversionComponentsPresent` — `{ cr: bool, cpa: bool, revenue: bool }` from `opt_clients`. Default: CR + CPA present, revenue not.

## Components + weights (Table 2)
| Component | Weight (with revenue) | Weight (without revenue) | Direction |
|---|---|---|---|
| Conversion rate | 0.50 | 0.65 | higher is better |
| Cost per conversion | 0.30 | 0.35 | lower is better |
| Revenue per visit | 0.20 | — | higher is better |

When `componentsPresent.revenue` is false (B2B MSP common case), the 0.20 weight redistributes to CR + CPA per addendum Q1.6.1. The decision to redistribute to CR + CPA (rather than to alignment + behaviour) is documented in the Slice 12 PR description.

## Normalisation
Same percentile approach as behaviour-subscore: 25th/75th client cohort, with `lower_is_better` inverted for CPA.

## When the score returns NULL
- The caller has flagged the page `conversion_n_a = TRUE` (composite-score handles redistribution at a higher layer)
- Both CR and CPA are NULL

## Output
```ts
{ score: 0..100, components: { ... }, weights_applied: { ... } }
```

## Pointers
- `lib/optimiser/scoring/conversion-subscore.ts:computeConversionSubscore`
- `lib/optimiser/scoring/conversion-subscore.ts:costPerConversionFromRollup`
- Caller: `lib/optimiser/scoring/evaluate-scores-job.ts`
