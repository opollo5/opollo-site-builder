-- Rollback for 0033_optimiser_campaigns.sql
DROP POLICY IF EXISTS opt_campaigns_write ON opt_campaigns;
DROP POLICY IF EXISTS opt_campaigns_read ON opt_campaigns;
DROP POLICY IF EXISTS service_role_all ON opt_campaigns;
ALTER TABLE IF EXISTS opt_campaigns DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_campaigns_client_status_idx;
DROP INDEX IF EXISTS opt_campaigns_client_external_uniq;
DROP TABLE IF EXISTS opt_campaigns;
