-- Rollback for 0038_optimiser_metrics_daily.sql
DROP POLICY IF EXISTS opt_metrics_daily_read ON opt_metrics_daily;
DROP POLICY IF EXISTS service_role_all ON opt_metrics_daily;
ALTER TABLE IF EXISTS opt_metrics_daily DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_metrics_daily_client_date_idx;
DROP INDEX IF EXISTS opt_metrics_daily_page_date_idx;
DROP INDEX IF EXISTS opt_metrics_daily_uniq;
DROP TABLE IF EXISTS opt_metrics_daily;
