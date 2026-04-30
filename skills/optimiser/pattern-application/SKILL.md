# Skill — pattern-application (Phase 3)

Apply cross-client patterns from `opt_pattern_library` as priors when generating new proposals (§11.2.1, Phase 3 Slice 23).

## When this fires
Inside `generateProposal` (`lib/optimiser/proposal-generation.ts`). Before writing the new `opt_proposals` row, the generator calls `applyPriorsToImpactRange` to maybe blend the playbook's seed impact range with cross-client observed effects.

## Hard gates
1. **Feature flag** — `OPT_PATTERN_LIBRARY_ENABLED` must be `true`. Spec §11.2.4 requires MSA-clause adoption before flipping in production.
2. **Receiving-client consent** — `opt_clients.cross_client_learning_consent` must be `true` for the proposal's client. Per §11.2.2, consent gates BOTH contribution AND application: a non-consenting client doesn't contribute observations, and doesn't receive cross-client priors either.
3. **Matching pattern** — at least one row in `opt_pattern_library` with `triggering_playbook_id = proposal.triggering_playbook_id`.

When any gate fails, the generator falls through to seed-only impact range. The proposal is still generated normally.

## Blend formula
The pattern's 95% credible interval is blended with the playbook's seed range. The blend weight depends on the pattern's confidence:

| Confidence | Pattern weight | Seed weight |
|---|---|---|
| `high` | 0.50 | 0.50 |
| `moderate` | 0.375 | 0.625 |
| `low` | 0.25 | 0.75 |

`expected_min_pp = seed_min × (1 − w) + pattern.ci_low × w`
`expected_max_pp = seed_max × (1 − w) + pattern.ci_high × w`

Output range is clamped to `[min(min,max), max(min,max)]` so a wide negative blend doesn't invert.

## Pattern selection
When multiple patterns match the same playbook, the generator picks the row with highest confidence (`high > moderate > low`) then highest `sample_size_clients`. Other rows surface in the proposal review UI's `PatternPriorsPanel` as supporting evidence.

## UI surface
`PatternPriorsPanel` on the proposal review page. Renders only when:
- The feature flag is on
- The receiving client consents
- ≥ 1 pattern matches the proposal's playbook

Shows: total observations across consenting clients, mean effect with 95% CI, pattern's structural description, supporting rows for other matches. **Anonymisation guarantee**: only structural fields render — no client names, URLs, copy, testimonials, or pricing.

## Spec
§11.2.1 (what is shared — patterns, not content), §11.2.2 (consent gating, both directions), §11.2.3 (anonymisation), §11.2.4 (legal action required), §6 feature 10.

## Pointers
- `lib/optimiser/pattern-library/priors.ts:applyPriorsToImpactRange` — generator integration
- `lib/optimiser/pattern-library/priors.ts:listRelevantPatterns` — UI reader
- `lib/optimiser/proposal-generation.ts` — caller (Slice 23 wiring)
- `components/optimiser/PatternPriorsPanel.tsx` — review UI
- `app/optimiser/proposals/[id]/page.tsx` — page that mounts the panel
