-- Rollback for 0010_m4_1_image_library_schema.sql.
-- Drops the M4 image-library tables. Does NOT restore row data.
-- Intended for local dev / CI reset, not production recovery.
--
-- Reverse order of creation so FK dependencies unwind cleanly.

DROP POLICY IF EXISTS transfer_events_read         ON transfer_events;
DROP POLICY IF EXISTS transfer_job_items_read      ON transfer_job_items;
DROP POLICY IF EXISTS transfer_jobs_read           ON transfer_jobs;
DROP POLICY IF EXISTS image_usage_read             ON image_usage;
DROP POLICY IF EXISTS image_metadata_update        ON image_metadata;
DROP POLICY IF EXISTS image_metadata_write         ON image_metadata;
DROP POLICY IF EXISTS image_metadata_read          ON image_metadata;
DROP POLICY IF EXISTS image_library_update         ON image_library;
DROP POLICY IF EXISTS image_library_write          ON image_library;
DROP POLICY IF EXISTS image_library_read           ON image_library;

DROP POLICY IF EXISTS service_role_all ON transfer_events;
DROP POLICY IF EXISTS service_role_all ON transfer_job_items;
DROP POLICY IF EXISTS service_role_all ON transfer_jobs;
DROP POLICY IF EXISTS service_role_all ON image_usage;
DROP POLICY IF EXISTS service_role_all ON image_metadata;
DROP POLICY IF EXISTS service_role_all ON image_library;

ALTER TABLE IF EXISTS transfer_events     DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transfer_job_items  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transfer_jobs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS image_usage         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS image_metadata      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS image_library       DISABLE ROW LEVEL SECURITY;

DROP TABLE IF EXISTS transfer_events;
DROP TABLE IF EXISTS transfer_job_items;
DROP TABLE IF EXISTS transfer_jobs;
DROP TABLE IF EXISTS image_usage;
DROP TABLE IF EXISTS image_metadata;
DROP TABLE IF EXISTS image_library;
