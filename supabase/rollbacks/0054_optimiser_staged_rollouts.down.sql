-- Rollback for 0054_optimiser_staged_rollouts.sql.

DROP INDEX IF EXISTS opt_staged_rollouts_client_idx;
DROP INDEX IF EXISTS opt_staged_rollouts_proposal_idx;
DROP INDEX IF EXISTS opt_staged_rollouts_live_idx;
DROP TABLE IF EXISTS opt_staged_rollouts;
