# Skill — proposal-generation

Assemble an `opt_proposals` row from a fired playbook and the page's current data. Idempotent on `(landing_page_id, triggering_playbook_id)` for active proposals — re-runs don't double-up.

## Inputs
```ts
{
  clientId,
  landingPageId,
  adGroupId,
  playbook,           // PlaybookRow
  rollup,             // PageMetricsRollup
  alignmentScore,     // 0–100 or null
  alignmentSubscores,
  triggerEvidence,    // from evaluatePlaybook
  triggerMagnitude,
  metricSeries,       // for stability factor
  suppressed          // Set<playbook_id> for §11.1 reason-gated suppression
}
```

## Priority score (§9.4)
```
priority_score = (impact_score × confidence_score) / effort_weight
```
- `impact_score` (0–100) — Phase 1: `seed_midpoint × log10(sessions+1) / 4`, scaled. Slice 6 normalises across the client's pending pool.
- `confidence_score` — from `confidence-calculation` skill.
- `effort_weight` — from `opt_playbooks.default_effort_bucket` (1 / 2 / 4).

## Risk classification (§9.2)
Inherits `playbook.default_risk_level` (low / medium / high). Phase 1 all risks require manual approval.

## Expiry
`expires_at = now + 14 days` (§9.7 default).

## Evidence
One `opt_proposal_evidence` row per fired condition, plus one row referencing the alignment score if non-null. Stored in display order so the review pane reads them top-to-bottom.

## Output behaviour
- `{ inserted: true, proposal_id, reason: "ok" }` — new pending proposal in `opt_proposals`.
- `{ inserted: false, reason: "duplicate" }` — pending/approved proposal exists for the same `(page, playbook)`.
- `{ inserted: false, reason: "suppressed" }` — `suppressed` set contains the playbook id (§11.1 — Slice 6).

## Guardrails (§10)
The change_set always carries `playbook.fix_template` verbatim. The Site Builder generation engine (Phase 1.5) enforces the §10 invariants when the brief is submitted — never invent claims, never fabricate testimonials, never change core_offer without high-risk approval, etc. Phase 1 stores the change-set; Phase 1.5 lints it before brief submission.

## Spec
§9.1, §9.4, §9.7.

## Pointers
- `lib/optimiser/proposal-generation.ts:generateProposal`
- Caller: `lib/optimiser/score-pages-job.ts`
