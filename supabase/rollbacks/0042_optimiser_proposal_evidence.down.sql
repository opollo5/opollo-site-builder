-- Rollback for 0042_optimiser_proposal_evidence.sql
DROP POLICY IF EXISTS opt_proposal_evidence_read ON opt_proposal_evidence;
DROP POLICY IF EXISTS service_role_all ON opt_proposal_evidence;
ALTER TABLE IF EXISTS opt_proposal_evidence DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_proposal_evidence_proposal_idx;
DROP TABLE IF EXISTS opt_proposal_evidence;
