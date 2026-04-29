-- Rollback for 0052_optimiser_full_page_output.sql.
-- Drops the four columns added by the forward migration.

ALTER TABLE opt_clients DROP COLUMN IF EXISTS tracking_config;
ALTER TABLE opt_change_log DROP COLUMN IF EXISTS dry_run_payload;
ALTER TABLE site_conventions DROP COLUMN IF EXISTS full_page_chrome;
ALTER TABLE brief_pages DROP COLUMN IF EXISTS output_mode;
