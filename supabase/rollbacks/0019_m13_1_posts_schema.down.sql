-- Rollback for 0019_m13_1_posts_schema.sql.
-- Drops the M13-1 posts table + RLS policies.
-- Does NOT restore row data. Intended for local dev / CI reset.
--
-- Reverse order of creation so FK/policy dependencies unwind cleanly.

DROP POLICY IF EXISTS posts_delete      ON posts;
DROP POLICY IF EXISTS posts_update      ON posts;
DROP POLICY IF EXISTS posts_insert      ON posts;
DROP POLICY IF EXISTS posts_read        ON posts;
DROP POLICY IF EXISTS service_role_all  ON posts;

ALTER TABLE IF EXISTS posts DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS idx_posts_author;
DROP INDEX IF EXISTS idx_posts_site_updated;
DROP INDEX IF EXISTS idx_posts_site_status;
DROP INDEX IF EXISTS posts_site_slug_live_unique;
DROP INDEX IF EXISTS posts_site_wp_post_unique;

DROP TABLE IF EXISTS posts;
