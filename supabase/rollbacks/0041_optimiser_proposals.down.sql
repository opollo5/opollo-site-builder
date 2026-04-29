-- Rollback for 0041_optimiser_proposals.sql
DROP POLICY IF EXISTS opt_proposals_write ON opt_proposals;
DROP POLICY IF EXISTS opt_proposals_read ON opt_proposals;
DROP POLICY IF EXISTS service_role_all ON opt_proposals;
ALTER TABLE IF EXISTS opt_proposals DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_proposals_expires_at_idx;
DROP INDEX IF EXISTS opt_proposals_landing_page_idx;
DROP INDEX IF EXISTS opt_proposals_client_status_priority_idx;
DROP TABLE IF EXISTS opt_proposals;
