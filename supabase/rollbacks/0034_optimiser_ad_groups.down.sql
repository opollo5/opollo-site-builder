-- Rollback for 0034_optimiser_ad_groups.sql
DROP POLICY IF EXISTS opt_ad_groups_write ON opt_ad_groups;
DROP POLICY IF EXISTS opt_ad_groups_read ON opt_ad_groups;
DROP POLICY IF EXISTS service_role_all ON opt_ad_groups;
ALTER TABLE IF EXISTS opt_ad_groups DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_ad_groups_campaign_idx;
DROP INDEX IF EXISTS opt_ad_groups_client_external_uniq;
DROP TABLE IF EXISTS opt_ad_groups;
