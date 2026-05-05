-- Rollback for 0067_site_mode_columns.sql
-- Drops the three columns added on sites. Does NOT preserve any
-- captured mode / extracted design data. Intended for local dev / CI
-- reset, not production recovery.

ALTER TABLE sites DROP COLUMN IF EXISTS extracted_css_classes;
ALTER TABLE sites DROP COLUMN IF EXISTS extracted_design;
ALTER TABLE sites DROP COLUMN IF EXISTS site_mode;
