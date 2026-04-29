# Skill — technical-subscore

Compute the v1.6 Technical sub-score per addendum §2.2.4.

## Inputs
- `PageMetricsRollup` (LCP + mobile speed score from PSI)
- Optional `{ inp_ms, cls }` from the most-recent PSI row

All four come from PageSpeed Insights mobile data — already ingested in v1.5 §4.4.

## Components + weights (Table 3)
| Component | Weight | Threshold (good → poor) |
|---|---|---|
| Largest Contentful Paint | 0.35 | 2500ms → 4000ms |
| Interaction to Next Paint | 0.25 | 200ms → 500ms |
| Cumulative Layout Shift | 0.20 | 0.1 → 0.25 |
| Mobile speed score | 0.20 | (already 0–100) |

## Threshold mapping
Each Core Web Vital maps to 0–100 by linear interpolation between Google's good and poor thresholds:
- value ≤ good → 100
- value ≥ poor → 0
- linear in between (so the midpoint between good and poor anchors at 50)

Mobile speed score is taken as-is.

## Why mobile only
Mobile is the dominant traffic source for paid landing pages. Desktop CWV is correlated but not the primary signal.

## When the score returns NULL
- LCP, INP, CLS are all unavailable AND mobile_speed_score is NULL — this happens when PSI hasn't run yet or the URL was unreachable

## Output
```ts
{ score: 0..100, components: { ... }, components_used: 1..4 }
```

## Pointers
- `lib/optimiser/scoring/technical-subscore.ts:computeTechnicalSubscore`
- Cron that populates the underlying PSI data: `/api/cron/optimiser-sync-pagespeed`
- Caller: `lib/optimiser/scoring/evaluate-scores-job.ts`
