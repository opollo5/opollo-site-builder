-- Rollback for 0060_design_discovery_columns.sql
-- Drops the eight columns the forward migration added on sites.
-- Does NOT preserve any captured data. Intended for local dev / CI
-- reset, not production recovery.

ALTER TABLE sites
  DROP COLUMN IF EXISTS tone_of_voice_status,
  DROP COLUMN IF EXISTS tone_of_voice,
  DROP COLUMN IF EXISTS design_direction_status,
  DROP COLUMN IF EXISTS design_tokens,
  DROP COLUMN IF EXISTS tone_applied_homepage_html,
  DROP COLUMN IF EXISTS inner_page_concept_html,
  DROP COLUMN IF EXISTS homepage_concept_html,
  DROP COLUMN IF EXISTS design_brief;
