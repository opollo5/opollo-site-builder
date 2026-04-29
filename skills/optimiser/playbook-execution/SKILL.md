# Skill — playbook-execution

Evaluate a playbook's trigger against current page data and report `{fired, magnitude, reasons}`.

## Trigger schema
Each `opt_playbooks.trigger` JSONB is one of:
```json
{ "all": [{"metric": "...", "op": "...", "value": ...}, ...] }
{ "any": [{"metric": "...", "op": "...", "value": ...}, ...] }
```

`op` ∈ `gt | lt | gte | lte | eq | ne`. `metric` keys into the metric bag (see below).

## Metric bag (`MetricBag`)
- `alignment_score` (0–100 or null)
- `bounce_rate`, `conversion_rate`, `avg_scroll_depth`, `avg_scroll_depth_desktop`
- `form_starts`, `form_completion_rate`, `cta_verb_match`, `cta_above_fold`, `offer_above_fold`
- `lcp_ms`, `mobile_speed_score`, `mobile_cr_vs_desktop_ratio`
- `sessions_14d`, `conversions_14d`, `clicks_14d`

Built by `buildMetricBag({rollup, snapshot, alignmentScore, ctaVerbMatch, ...})`. The 14d series is currently approximated from the 30d rollup; Slice 5.1 wires a real 14d window when Ads click metrics land.

## Magnitude
For each fired numeric condition, distance from threshold scaled to `[0, 1]`:
- just over → 0.4
- severely over → 1.0
The mean across fired conditions is the playbook's `magnitude`, fed into the §9.4.1 `signal_factor`.

## Phase 1 playbook set (§9.6.1)
Seeded by migration `0040_optimiser_playbooks.sql`:
1. `message_mismatch` — alignment < 60 AND bounce > 65%
2. `weak_above_the_fold` — scroll depth desktop < 30% AND CTA below fold
3. `form_friction` — form starts > 50 AND completion < 40%
4. `cta_verb_mismatch` — CTA verb match = false
5. `offer_clarity` — scroll > 60% AND CR < 1.5% AND offer below fold

Plus 3 technical-alert playbooks (page_speed / tracking_broken / mobile_failure) — `evaluatePlaybook` runs on these too; the score-pages job ignores their fired status for proposal generation and writes them to `opt_landing_pages.active_technical_alerts` instead.

## Output
`{ fired: boolean, magnitude: number, reasons: [{metric, op, threshold, observed, passed}, ...] }`

The `reasons` array is the evidence payload for `opt_proposal_evidence` rows.

## Spec
§9.6, Tables 23 + 24 + 25.

## Pointers
- `lib/optimiser/playbook-execution.ts:evaluatePlaybook`
- Migration that seeds the Phase 1 set: `supabase/migrations/0040_optimiser_playbooks.sql`
