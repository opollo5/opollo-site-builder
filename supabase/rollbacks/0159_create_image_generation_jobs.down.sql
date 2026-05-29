-- Rollback for 0159. Only safe when the table is empty.
DROP POLICY IF EXISTS image_generation_jobs_company_read ON image_generation_jobs;
DROP TABLE IF EXISTS image_generation_jobs;
