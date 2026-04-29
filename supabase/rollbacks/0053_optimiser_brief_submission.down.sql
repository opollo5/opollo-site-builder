-- Rollback for 0053_optimiser_brief_submission.sql.

DROP INDEX IF EXISTS brief_runs_triggered_by_proposal_idx;
ALTER TABLE brief_runs DROP COLUMN IF EXISTS triggered_by_proposal_id;

ALTER TABLE opt_proposals
  DROP CONSTRAINT IF EXISTS opt_proposals_status_check;

-- Restore the original constraint (rolling back to 0041's enum).
ALTER TABLE opt_proposals
  ADD CONSTRAINT opt_proposals_status_check CHECK (status IN (
    'draft',
    'pending',
    'approved',
    'applied',
    'applied_promoted',
    'applied_then_reverted',
    'rejected',
    'expired'
  ));
