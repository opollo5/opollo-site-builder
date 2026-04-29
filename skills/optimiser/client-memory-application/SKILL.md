# Skill — client-memory-application

Read per-client memory and apply it to new proposal generation. Also handle the §11.1 reason-gated suppression rule.

## What's stored
`opt_client_memory` rows, three types:
- `rejected_pattern` — playbook+page_type+reason → count + last_rejected_at
- `winning_variant` — Phase 2 placeholder (A/B test winners)
- `preference` — design feedback (component / tone / density) — Phase 1 staff-curated

## Suppression rule (§11.1)
- Three rejections with the **same reason** for the same `(playbook, page_type)` combo → suppress that combination for that client.
- `bad_timing` rejections don't count toward suppression (they imply the issue is real, just deferred).
- Suppression is reversible — staff can clear from client settings (`setMemoryCleared(id, false, userId)`).

## How proposal-generation consumes it
`score-pages-job.ts` calls `suppressedPlaybooksFor(clientId)` once per client tick and passes the `Set<playbook_id>` into every `generateProposal()` call. The generator returns `{inserted: false, reason: 'suppressed'}` for any matching playbook, so suppressed proposals never reach the queue.

## Phase 1 wiring
On rejection (`POST /api/optimiser/proposals/{id}/reject`):
1. Update `opt_proposals.status = 'rejected'` with `rejection_reason_code`.
2. Call `recordRejection(...)` which bumps the matching `opt_client_memory` row.
3. Insert an `opt_change_log` row with `event = 'proposal_rejected'`.
4. If the bump pushed the count to ≥ 3 with the same non-`bad_timing` reason, the response carries `suppressed_now=true` and the UI shows a banner.

## Phase 2 / 3 hooks
- Winning-variant writes go in once Phase 2 A/B tests resolve.
- `preference` rows surface as priors in the brief construction (Phase 1.5+).
- Cross-client patterns (`opt_pattern_library`) are gated on `opt_clients.cross_client_learning_consent` (Phase 3).

## Spec
§11.1 and §11.2 (cross-client gating).

## Pointers
- `lib/optimiser/client-memory.ts:recordRejection`, `:suppressedPlaybooksFor`, `:listClientMemory`, `:setMemoryCleared`
- Caller: `lib/optimiser/proposals.ts:rejectProposal` and (Phase 2) `lib/optimiser/score-pages-job.ts`
