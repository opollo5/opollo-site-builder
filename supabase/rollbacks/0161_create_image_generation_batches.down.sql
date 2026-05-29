-- Rollback for 0161. Only safe when both tables are empty.
DROP INDEX IF EXISTS idx_image_generation_jobs_batch_state;
ALTER TABLE image_generation_jobs
  DROP COLUMN IF EXISTS parent_post_index,
  DROP COLUMN IF EXISTS target_publish_date,
  DROP COLUMN IF EXISTS target_platforms,
  DROP COLUMN IF EXISTS batch_id;
DROP POLICY IF EXISTS image_generation_batches_company_read ON image_generation_batches;
DROP TABLE IF EXISTS image_generation_batches;
