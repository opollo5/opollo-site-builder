-- 0159: image_generation_jobs — per-image job tracking for the B1 QStash handler.
--
-- batch_id FK and batch-level columns (parent_post_index, target_publish_date,
-- target_platforms) are added in migration 0160 (B2) via ALTER TABLE.
--
-- State machine (enforced by handler's atomic UPDATE WHERE):
--   pending → running → completed
--   pending → running → failed
--   pending → running → escalated
--
-- No state ever goes backwards. state=running with a stale started_at is
-- the signal for the V1 sweeper cron (B1 post-V1 backlog) to flip to failed.

CREATE TABLE IF NOT EXISTS image_generation_jobs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID        NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  state               TEXT        NOT NULL DEFAULT 'pending',
  CONSTRAINT image_generation_jobs_state_check
    CHECK (state IN ('pending', 'running', 'completed', 'failed', 'escalated')),
  generation_params   JSONB       NOT NULL,           -- serialised GenerationParams
  result_storage_path TEXT,                           -- storage path only, never a signed URL (§1.6)
  error_class         TEXT,
  error_detail        TEXT,
  triggered_by        UUID        REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

-- Partial index for the two states the handler queries on.
CREATE INDEX idx_image_generation_jobs_company_state
  ON image_generation_jobs(company_id, state)
  WHERE state IN ('pending', 'running');

-- RLS: company members read their own jobs.
-- All writes are service-role only.
ALTER TABLE image_generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS image_generation_jobs_company_read ON image_generation_jobs;
CREATE POLICY image_generation_jobs_company_read
  ON image_generation_jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM platform_company_users pcu
      WHERE pcu.user_id   = auth.uid()
        AND pcu.company_id = image_generation_jobs.company_id
        AND pcu.role IN ('editor', 'approver', 'admin')
    )
  );
