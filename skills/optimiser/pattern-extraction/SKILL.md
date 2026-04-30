# Skill — pattern-extraction (Phase 3)

Cross-client pattern extractor for the §11.2 anonymised pattern library. Phase 3 Slice 22.

## Cron
`/api/cron/optimiser-extract-patterns` runs daily at 10:00 UTC.

## Hard gates
1. **Feature flag** — `OPT_PATTERN_LIBRARY_ENABLED` must be `true` / `1`. When off, the extractor returns cleanly with no DB writes. Spec §11.2.4 requires MSA-clause adoption before flipping this in production; flag exists so engineering can ship the code in advance.
2. **Per-client consent** — only clients with `cross_client_learning_consent=true` on `opt_clients` contribute observations. Default is `false`; toggling requires admin action plus the legal precondition above.
3. **Minimum cohort** — patterns require ≥ 2 distinct consenting clients before any row is written. Single-client patterns are rejected with `reason: 'single_client_only'`.

## Sources
- `opt_causal_deltas` rows where `actual_impact_cr IS NOT NULL` — measured CR delta after applied proposals
- (Phase 3 future expansion) `opt_client_memory.winning_variants` rows from concluded A/B tests

Source rows are joined to `opt_proposals` to recover the triggering playbook id, then classified via `classifyVariantOutcome`.

## Anonymisation guarantees (by construction)
- `client_id`, `landing_page_id`, `proposal_id`, `ad_group_id` are read into memory only — they're used to count distinct clients / pages / ad groups during aggregation but never persist on `opt_pattern_library`.
- The persisted row carries `pattern_type`, structural variant + baseline labels, sample-size aggregates, effect mean + 95% CI, confidence label, optional triggering_playbook_id. **No copy, URLs, brand names, testimonial text, or pricing.**
- The schema has no foreign keys to client / page / proposal — the anonymisation invariant lives in the schema shape, not just in code.

## Pattern types
Phase 3 ships seven, with room to extend by adding cases to `classifyVariantOutcome`:
- `cta_position` (viewport_1 vs viewport_2_plus)
- `form_field_count` (le_5_fields vs gt_5_fields)
- `offer_above_fold`
- `trust_signal_placement`
- `social_proof_position`
- `cta_verb_match`
- `hero_keyword_match`
- `variant_b_twist` (for Slice 18 deterministic-fallback variants — centred_hero / trust_first / two_step_form)

## Aggregation
- Group observations by `(pattern_type, variant_label, baseline_label, triggering_playbook_id)`.
- Mean = simple mean of observed CR deltas (percentage points).
- 95% CI = `mean ± 1.96 × stddev / √n` (z-approximation).
- Confidence label:
  - `high` — ≥ 10 distinct consenting clients AND CI excludes 0
  - `moderate` — ≥ 5 distinct consenting clients
  - `low` — otherwise

## Idempotency
UPSERT keyed on `(pattern_type, variant_label, baseline_label, COALESCE(triggering_playbook_id, ''))`. The extractor recomputes the aggregate every tick and overwrites; re-running the cron is a no-op when the underlying observations haven't changed.

## Spec
§11.2 (cross-client learning), §11.2.3 (anonymisation), §11.2.4 (legal action required), §6 feature 10, §12.4.

## Pointers
- `lib/optimiser/pattern-library/extractor.ts:runPatternExtraction`
- `lib/optimiser/pattern-library/classify-pattern.ts`
- `lib/optimiser/pattern-library/feature-flag.ts:isPatternLibraryEnabled`
- Cron route: `app/api/cron/optimiser-extract-patterns/route.ts`
- Migration: `supabase/migrations/0061_optimiser_pattern_library.sql`
