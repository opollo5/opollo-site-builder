-- Rollback for 0066_design_discovery_regen_counts.sql
-- Drops the regeneration_counts column added on sites. Does NOT
-- preserve any captured count data. Intended for local dev / CI
-- reset, not production recovery.

ALTER TABLE sites DROP COLUMN IF EXISTS regeneration_counts;
