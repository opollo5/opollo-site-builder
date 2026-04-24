-- Rollback for 0021_m13_3_briefs_content_type.sql.
-- Drops the content_type column + its partial index.
-- Does NOT attempt to restore row data. Intended for local dev / CI reset.

DROP INDEX IF EXISTS idx_briefs_site_post_content_type;

ALTER TABLE briefs DROP COLUMN IF EXISTS content_type;
