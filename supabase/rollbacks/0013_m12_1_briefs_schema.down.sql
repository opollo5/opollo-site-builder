-- Rollback for 0013_m12_1_briefs_schema.sql.
-- Drops the M12-1 brief tables + the site-briefs Storage bucket + policies.
-- Does NOT restore row data. Intended for local dev / CI reset.
--
-- Reverse order of creation so FK dependencies unwind cleanly.

DROP POLICY IF EXISTS site_briefs_authed_read        ON storage.objects;
DROP POLICY IF EXISTS site_briefs_service_role_all   ON storage.objects;

DROP POLICY IF EXISTS site_conventions_delete        ON site_conventions;
DROP POLICY IF EXISTS site_conventions_update        ON site_conventions;
DROP POLICY IF EXISTS site_conventions_insert        ON site_conventions;
DROP POLICY IF EXISTS site_conventions_read          ON site_conventions;
DROP POLICY IF EXISTS service_role_all               ON site_conventions;

DROP POLICY IF EXISTS brief_runs_delete              ON brief_runs;
DROP POLICY IF EXISTS brief_runs_update              ON brief_runs;
DROP POLICY IF EXISTS brief_runs_insert              ON brief_runs;
DROP POLICY IF EXISTS brief_runs_read                ON brief_runs;
DROP POLICY IF EXISTS service_role_all               ON brief_runs;

DROP POLICY IF EXISTS brief_pages_delete             ON brief_pages;
DROP POLICY IF EXISTS brief_pages_update             ON brief_pages;
DROP POLICY IF EXISTS brief_pages_insert             ON brief_pages;
DROP POLICY IF EXISTS brief_pages_read               ON brief_pages;
DROP POLICY IF EXISTS service_role_all               ON brief_pages;

DROP POLICY IF EXISTS briefs_delete                  ON briefs;
DROP POLICY IF EXISTS briefs_update                  ON briefs;
DROP POLICY IF EXISTS briefs_insert                  ON briefs;
DROP POLICY IF EXISTS briefs_read                    ON briefs;
DROP POLICY IF EXISTS service_role_all               ON briefs;

ALTER TABLE IF EXISTS site_conventions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS brief_runs        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS brief_pages       DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS briefs            DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS site_conventions;
DROP TABLE IF EXISTS brief_runs;
DROP TABLE IF EXISTS brief_pages;
DROP TABLE IF EXISTS briefs;

DELETE FROM storage.buckets WHERE id = 'site-briefs';
