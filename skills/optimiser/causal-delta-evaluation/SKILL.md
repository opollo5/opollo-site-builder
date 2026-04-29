# Skill — causal-delta-evaluation

Compute and persist the v1.6 causal delta for an applied proposal once the rollout window has closed (addendum §4.3 + §9.8.5).

## When the evaluator fires
Daily cron `/api/cron/optimiser-evaluate-causal-deltas` (08:15 UTC). For each applied proposal in `opt_proposals`, the evaluator skips unless **either**:
- 14 days have passed since `applied_at` (or per-client override on `opt_clients.causal_eval_window_days`), **or**
- The new version has accumulated 300+ post-rollout sessions

whichever comes first.

## Inputs per proposal
- `opt_proposals` row: `landing_page_id`, `applied_at`, `change_set`, `expected_impact_*`, `triggering_playbook_id`, `before_snapshot.composite_score`
- `opt_metrics_daily` for the page: pre-window (matching duration immediately before rollout) + post-window (rollout to now)
- `opt_landing_pages.current_composite_score` — the post-rollout composite

## Computation
- `actual_impact_cr = (post_cr - pre_cr) / pre_cr` — relative %, NULL when either side has zero sessions
- `actual_impact_score = post_composite - pre_composite` — absolute composite delta in points, NULL when either side is missing
- Confidence per §9.4.1 against the post-rollout window:
  - `sample = min(1, post_sessions / 1000)`
  - `freshness = 1.0` (post = current)
  - `stability` from coefficient-of-variation of post-window bounce rate (≥3 days needed)
  - `signal = 0.4 / 0.6 / 0.9` based on conversion count thresholds (10 / 30)
  - `score = sample × freshness × stability × signal`

## Persistence
UPSERT into `opt_causal_deltas` keyed on `proposal_id`. Re-running the evaluator on the same proposal updates the existing row (e.g. once more post-window data has accumulated).

`fed_into_calibration` defaults FALSE so a future Phase 2 calibration loop can pick up unconsumed deltas without re-querying historical data.

## Confidence vs. composite-score confidence
**Q1.6.2 decision** — kept separate, displayed adjacently. The composite-score's reliability dot reflects "is the data trustworthy at this snapshot"; the causal-delta's confidence reflects "is the measured impact statistically real". Same formula, different windows. Both surfaced in the UI per addendum §4.3.

## Surfaces
- Score history table (`/optimiser/pages/[id]`): causal-delta column shows `+1.2% CR` or `+9 pts` per row keyed by `triggering_proposal_id`
- Proposal review screen: "what happened last time we did this" panel queries `listRecentCausalDeltasForPlaybook(client, playbook)` — surfaces past 5 deltas for the same playbook on the same client

## Phase 2 calibration loop hook
Once A/B tests start producing winner data, `fed_into_calibration` flips TRUE after the row drives a `seed_impact_*` update on `opt_playbooks` per §9.4.2. Phase 1 ships the writer; the loop activates in Phase 2.

## Pointers
- `lib/optimiser/causal/evaluate-deltas.ts:runCausalDeltaEvaluationForAllClients`
- `lib/optimiser/causal/read-deltas.ts:listRecentCausalDeltasForPlaybook`
- Cron route: `/api/cron/optimiser-evaluate-causal-deltas`
