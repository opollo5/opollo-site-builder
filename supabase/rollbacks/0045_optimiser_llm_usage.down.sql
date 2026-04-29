-- Rollback for 0045_optimiser_llm_usage.sql
DROP POLICY IF EXISTS opt_llm_usage_read ON opt_llm_usage;
DROP POLICY IF EXISTS service_role_all ON opt_llm_usage;
ALTER TABLE IF EXISTS opt_llm_usage DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_llm_usage_client_month_idx;
DROP INDEX IF EXISTS opt_llm_usage_client_created_idx;
DROP TABLE IF EXISTS opt_llm_usage;
