# Skill — confidence-calculation

Compute the four-factor confidence score per spec §9.4.1.

## Formula
```
confidence_score = sample × freshness × stability × signal
```

Each factor is in `[0, 1]`. The product means any single weak factor pulls the whole score down — a fresh dataset with low session count is not high-confidence even if the signal is strong.

## Factors
- **sample** = `min(1, sessions / 1000)`. 100 sessions → 0.10. 1,000+ → 1.0. < 100 is below §9.5 threshold and produces no proposal at all.
- **freshness** = 1.0 if data ≤ 7 days old; linear decay to 0.5 by day 14. After day 14 the proposal expires (§9.7).
- **stability** = `1 - coefficient_of_variation` of the metric series across the window, clamped to `[0, 1]`. Catches one-off spikes. Falls back to 0.7 when no series available.
- **signal** = magnitude of the deviation from the playbook's trigger threshold. Just-over = 0.4, severely over = 1.0.

## Worked example (spec §9.4.1)
800 sessions over 10 days, bounce rate stable 72% ±4%, scroll depth 25% (well under 30% playbook threshold). `sample 0.80 × freshness 0.79 × stability 0.94 × signal 0.83 ≈ 0.49`. Moderate — visible to staff but not at the top of the queue.

## Output
`{ score, sample, freshness, stability, signal }` — all four sub-factors persisted on `opt_proposals` so the review pane can show the breakdown.

## Calibration
Defaults baked in. Per-client overrides go in `opt_clients.confidence_overrides` (Phase 2).

## Spec
§9.4.1.

## Pointers
- `lib/optimiser/confidence.ts:computeConfidence`
- Caller: `lib/optimiser/proposal-generation.ts:generateProposal`
