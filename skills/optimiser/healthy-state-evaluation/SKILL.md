# Skill — healthy-state-evaluation

Evaluate whether a managed landing page meets §9.9 healthy criteria and persist the result onto `opt_landing_pages`.

## Inputs
- `landing_page_id`, `client_id`
- `management_mode` from `opt_landing_pages`
- 30-day rollup from `lib/optimiser/metrics-aggregation.ts:rollupForPage`
- Reliability checks from `lib/optimiser/data-reliability.ts:computeReliability`
- Latest alignment score from `opt_alignment_scores` (if any — Slice 5 lands these)
- Per-client active-pages average CR (SUM(conv) / SUM(sessions) over the last 30 days from active pages)

## State decision tree
1. `management_mode = 'read_only'` → state = `read_only_external`.
2. §9.5 thresholds (`sessions ≥ 100`, `conversions ≥ 10` OR `spend ≥ $500`, `window ≥ 7 days`) — if any fails → `insufficient_data`.
3. `alignment_score ≥ 70`, `CR within ±20% of client active avg`, no playbook firing, no technical alert → `healthy`.
4. Otherwise → `active`.

## Technical alert detection
The healthy-state job derives the alert set inline from the rollup:
- `page_speed` if `lcp_ms > 2500` OR `mobile_speed_score < 50`
- `mobile_only_failure` if `mobile_cr_vs_desktop_ratio < 0.25`

`tech_tracking_broken` requires Ads click data without conversions — added in Slice 5 when ad-side metrics land.

## Persistence
On evaluation:
- `opt_landing_pages.state` = the result
- `opt_landing_pages.state_evaluated_at` = `now()`
- `opt_landing_pages.state_reasons` = each reason as `{code, message, passed}`
- `opt_landing_pages.data_reliability` + `data_reliability_checks` per the reliability output
- `opt_landing_pages.active_technical_alerts` = the derived alert set
- On state change, an `opt_change_log` row with `event = 'page_state_transition'` is inserted.

## Cadence
- Daily cron at 07:00 UTC (`/api/cron/optimiser-evaluate-pages`)
- On-demand: Slice 5 will call the evaluator immediately after persisting a new alignment score.

## Spec
§9.9, §9.6.3, §9.5.

## Pointers
- `lib/optimiser/healthy-state.ts:evaluateHealthyState` (pure function)
- `lib/optimiser/healthy-state.ts:evaluateAndPersistPage` (full job step)
- `lib/optimiser/evaluate-pages-job.ts` (cron orchestration)
