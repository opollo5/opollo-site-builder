-- Rollback for 0036_optimiser_ads.sql
DROP POLICY IF EXISTS opt_ads_write ON opt_ads;
DROP POLICY IF EXISTS opt_ads_read ON opt_ads;
DROP POLICY IF EXISTS service_role_all ON opt_ads;
ALTER TABLE IF EXISTS opt_ads DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS opt_ads_client_idx;
DROP INDEX IF EXISTS opt_ads_ad_group_external_uniq;
DROP TABLE IF EXISTS opt_ads;
