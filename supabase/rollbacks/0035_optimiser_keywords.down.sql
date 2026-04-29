-- Rollback for 0035_optimiser_keywords.sql
DROP POLICY IF EXISTS opt_keywords_write ON opt_keywords;
DROP POLICY IF EXISTS opt_keywords_read ON opt_keywords;
DROP POLICY IF EXISTS service_role_all ON opt_keywords;
ALTER TABLE IF EXISTS opt_keywords DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_keywords_client_idx;
DROP INDEX IF EXISTS opt_keywords_ad_group_external_uniq;
DROP TABLE IF EXISTS opt_keywords;
