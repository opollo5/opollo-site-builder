-- 0053 — OPTIMISER PHASE 1.5 SLICE 15: brief submission integration.
--
-- Two schema additions:
--
--   1. opt_proposals.status gains two new values:
--        - 'applying'             — submit-brief succeeded, brief_run is
--                                    queued/running, generation in
--                                    progress.
--        - 'applied_then_failed'  — brief_run terminated in `failed`
--                                    state. Operator notified; staff
--                                    can re-trigger via the proposal
--                                    review screen.
--
--   2. brief_runs.triggered_by_proposal_id — nullable FK back to
--      opt_proposals. Lets the slice-15 sync helper find the brief_run
--      that corresponds to a given proposal, and lets the slice-16
--      staged-rollout monitor know the lineage when a generation
--      lands. NULL for operator-uploaded briefs (the existing
--      brief-runner path).
--
-- Forward-only. The CHECK constraint on opt_proposals.status is
-- altered in two steps to satisfy Postgres' constraint-replacement
-- semantics; the new constraint accepts every value the old one did
-- plus the two new states.

-- 1. opt_proposals.status enum extension
ALTER TABLE opt_proposals
  DROP CONSTRAINT IF EXISTS opt_proposals_status_check;

ALTER TABLE opt_proposals
  ADD CONSTRAINT opt_proposals_status_check CHECK (status IN (
    'draft',
    'pending',
    'approved',
    'applying',
    'applied',
    'applied_promoted',
    'applied_then_reverted',
    'applied_then_failed',
    'rejected',
    'expired'
  ));

COMMENT ON COLUMN opt_proposals.status IS
  'State machine: draft → pending → approved → applying → applied → applied_promoted | applied_then_reverted | applied_then_failed; OR pending → rejected | expired. `applying` and `applied_then_failed` added 2026-04-30 (OPTIMISER-15) for the brief-submission integration.';

-- 2. brief_runs.triggered_by_proposal_id
ALTER TABLE brief_runs
  ADD COLUMN triggered_by_proposal_id uuid
    REFERENCES opt_proposals(id) ON DELETE SET NULL;

CREATE INDEX brief_runs_triggered_by_proposal_idx
  ON brief_runs (triggered_by_proposal_id)
  WHERE triggered_by_proposal_id IS NOT NULL;

COMMENT ON COLUMN brief_runs.triggered_by_proposal_id IS
  'When this brief_run was triggered by an optimiser proposal approval, this references the opt_proposals row. NULL for operator-uploaded briefs. Set to NULL on proposal delete (history is in opt_change_log; no cascade needed). Added 2026-04-30 (OPTIMISER-15).';
