-- Rollback for 0057_optimiser_ab_variants_tests.sql
DROP POLICY IF EXISTS opt_tests_read ON opt_tests;
DROP POLICY IF EXISTS service_role_all ON opt_tests;
ALTER TABLE IF EXISTS opt_tests DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_tests_running_idx;
DROP INDEX IF EXISTS opt_tests_client_status_idx;
DROP INDEX IF EXISTS opt_tests_one_running_per_page_uniq;
DROP TABLE IF EXISTS opt_tests;

DROP POLICY IF EXISTS opt_variants_read ON opt_variants;
DROP POLICY IF EXISTS service_role_all ON opt_variants;
ALTER TABLE IF EXISTS opt_variants DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_variants_landing_page_idx;
DROP INDEX IF EXISTS opt_variants_client_status_idx;
DROP INDEX IF EXISTS opt_variants_proposal_idx;
DROP TABLE IF EXISTS opt_variants;
