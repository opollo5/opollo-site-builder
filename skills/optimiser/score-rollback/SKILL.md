# Skill — score-rollback

Roll a managed page back to a target score-history version (addendum §4.4 + §9.8.6).

## Endpoint
`POST /api/optimiser/pages/[id]/rollback`

Body:
```ts
{
  target_history_id: uuid,  // an opt_page_score_history row for this page
  reason: string,           // required for the audit trail
}
```

Authorisation: `admin` or `operator` role per `checkAdminAccess`.

## Flow

1. Look up the target `opt_page_score_history` row + verify it belongs to the page in the URL.
2. Find the most recent applied / applied_promoted proposal for the page (the one being rolled back FROM).
3. Flip that proposal to `applied_then_reverted`.
4. Insert an `opt_change_log` row with `event = 'manual_rollback'`, the staff actor id, target version metadata, and `site_builder_rollback_pending: true` (Phase 1 marker).
5. Update `opt_landing_pages.current_composite_score` + `current_classification` to the target version's values so the page browser reflects the restored state without waiting for the next cron tick.

## What Phase 1 does NOT do

The Site Builder's rollback endpoint isn't called yet — it lands in Phase 1.5 alongside brief submission. Phase 1's rollback is the **audit trail + score reconciliation**; the actual page bytes don't change. The `site_builder_rollback_pending: true` flag in the change-log details payload is the marker the Phase 1.5 wiring will pick up.

## UI

`components/optimiser/RollbackButton.tsx` — client component opened from each prior-version row in `ScoreHistoryTable`. Confirmation modal shows:
- Target composite + classification + evaluated_at
- Reason textarea (required)
- Confirm / cancel

The current row (latest) doesn't show a rollback button — there's no version newer than current to roll back to.

## Score re-evaluation

Phase 1 surface restores the cached score from the target history row directly. The next `/api/cron/optimiser-evaluate-scores` tick will reconcile against the live page state. Phase 1.5 can swap to a "force re-evaluate" call after the Site Builder rollback completes for tighter ordering.

## Spec

§4.4 (rollback as a first-class UI feature), §9.8.6, `addendum-v1.6.docx`.

## Pointers
- `app/api/optimiser/pages/[id]/rollback/route.ts`
- `components/optimiser/RollbackButton.tsx`
- `components/optimiser/ScoreHistoryTable.tsx` (caller)
- `lib/optimiser/change-log.ts:recordChangeLog` (audit-trail writer)
