-- Rollback for 0037_optimiser_landing_pages.sql
DROP POLICY IF EXISTS opt_landing_pages_write ON opt_landing_pages;
DROP POLICY IF EXISTS opt_landing_pages_read ON opt_landing_pages;
DROP POLICY IF EXISTS service_role_all ON opt_landing_pages;
ALTER TABLE IF EXISTS opt_landing_pages DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_landing_pages_page_idx;
DROP INDEX IF EXISTS opt_landing_pages_managed_idx;
DROP INDEX IF EXISTS opt_landing_pages_client_url_uniq;
DROP TABLE IF EXISTS opt_landing_pages;
