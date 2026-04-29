# Skill — winner-detection

Bayesian winner detection for the §6 feature 8 A/B test monitor (Phase 2 Slice 19).

## Cron
`/api/cron/optimiser-ab-monitor` runs hourly (15 past). For every `opt_tests` row with `status='running'`, the monitor pulls fresh GA4 metrics from `opt_metrics_daily` (dimensioned on `opt_v=A|B`), computes the Bayesian posterior, and may end the test.

## Bayesian model
Each variant's true CR is `Beta(1 + conversions, 1 + sessions − conversions)` — a Beta posterior with a uniform `Beta(1, 1)` prior. We compute `P(theta_b > theta_a)` via 100,000 Monte Carlo draws using a deterministic mulberry32 PRNG seeded by the input tuple. Same inputs → same probability output, so the persisted `winner_probability_*` fields are stable.

### Sampling
- Beta draws via Gamma ratio: `X ~ Gamma(alpha, 1) / (X + Y ~ Gamma(beta, 1))`.
- Gamma sampling uses Marsaglia-Tsang for shape ≥ 1 (the only path that fires given the §12.3 floors guarantee `alpha ≥ 11`).

## Decision rule
- If `P(B > A) ≥ 0.95` → status `winner_b`.
- If `P(A > B) ≥ 0.95` → status `winner_a`.
- If max-window expires without either threshold crossing AND posterior means differ by > 0.001 → pick higher-mean variant as winner; else `inconclusive`.
- Otherwise persist the latest probabilities + snapshot and continue.

## Minimum-sample floors (§12.3)
- ≥ 100 sessions per variant
- ≥ 10 conversions per variant

Below these the monitor records the snapshot but skips the probability call entirely. The §12.3 max window (default 7 days, per-client overridable on `opt_clients.staged_rollout_config.maximum_window_days`) eventually forces a decision.

## On winner detected
1. Flip `opt_tests.status` to `winner_a` / `winner_b` with `ended_at`, `ended_reason`, latest probabilities + snapshot.
2. Mark winning `opt_variants.status = 'active'`, losing variant `'superseded'`.
3. Append to `opt_change_log` with `event = 'ab_winner_promoted'` (or `ab_test_inconclusive`).
4. UPSERT `opt_client_memory` row with `memory_type='winning_variant'` and key `<playbook>:<page_type>:<variant_label>` so future proposals for this client bias toward the winning structural pattern (§11.1).
5. Recalibrate the triggering playbook's `seed_impact_min_pp` / `seed_impact_max_pp` via the §9.4.2 weighted-average loop (30% seed, 70% observed) and append a row to `opt_playbook_calibration` with `reason='observed'`.

## UI
`AbTestStatusBanner` on the page detail view shows:
- Current status (running / winner_a / winner_b / inconclusive / stopped)
- Traffic split + start time + end time + end reason
- Per-variant cards with sessions / conversions / CR / probability of being best
- Last evaluated timestamp

## Pointers
- `lib/optimiser/ab-testing/bayesian.ts:computeWinnerProbability`
- `lib/optimiser/ab-testing/monitor.ts:runAbMonitorTick`, `:evaluateTest`, `:endTest`
- `app/api/cron/optimiser-ab-monitor/route.ts`
- `components/optimiser/AbTestStatusBanner.tsx`
- Spec: §6 feature 8, §9.4.2 (calibration), §11.1 (winning variants), §12.3
