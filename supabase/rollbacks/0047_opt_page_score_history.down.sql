-- Rollback for 0047_opt_page_score_history.sql
DROP POLICY IF EXISTS opt_page_score_history_read ON opt_page_score_history;
DROP POLICY IF EXISTS service_role_all ON opt_page_score_history;
ALTER TABLE IF EXISTS opt_page_score_history DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_page_score_history_proposal_idx;
DROP INDEX IF EXISTS opt_page_score_history_client_evaluated_idx;
DROP INDEX IF EXISTS opt_page_score_history_page_evaluated_idx;
DROP TABLE IF EXISTS opt_page_score_history;
