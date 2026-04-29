-- Rollback for 0046_optimiser_change_log.sql
DROP POLICY IF EXISTS opt_change_log_read ON opt_change_log;
DROP POLICY IF EXISTS service_role_all ON opt_change_log;
ALTER TABLE IF EXISTS opt_change_log DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_change_log_landing_page_idx;
DROP INDEX IF EXISTS opt_change_log_proposal_idx;
DROP INDEX IF EXISTS opt_change_log_client_created_idx;
DROP TABLE IF EXISTS opt_change_log;
