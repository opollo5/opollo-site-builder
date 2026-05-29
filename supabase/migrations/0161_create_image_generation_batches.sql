-- 0161: image_generation_batches and batch-level columns on image_generation_jobs.
--
-- image_generation_batches: groups N image jobs under one operator action.
-- image_generation_jobs gains batch_id FK + per-job routing columns.
--
-- §1.7 of the mass-image-gen brief: budget and counts are in jobs, not rows.
-- total_jobs = sum of distinct aspect ratios across all source rows.
-- source_row_count is optional metadata for UI display ("30 posts → 90 images").

-- ─── image_generation_batches ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS image_generation_batches (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID        NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  state            TEXT        NOT NULL DEFAULT 'pending',
  CONSTRAINT image_generation_batches_state_check
    CHECK (state IN ('pending', 'running', 'completed', 'partial', 'failed')),
  total_jobs       INT         NOT NULL DEFAULT 0,
  completed_jobs   INT         NOT NULL DEFAULT 0,
  failed_jobs      INT         NOT NULL DEFAULT 0,
  -- Operator-facing metadata (populated by C4 ingestion route).
  source_filename  TEXT,
  source_row_count INT,                -- source document row count (not job count)
  triggered_by     UUID        REFERENCES platform_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_image_generation_batches_company_state
  ON image_generation_batches(company_id, state);

ALTER TABLE image_generation_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS image_generation_batches_company_read ON image_generation_batches;
CREATE POLICY image_generation_batches_company_read
  ON image_generation_batches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM platform_company_users pcu
      WHERE pcu.user_id   = auth.uid()
        AND pcu.company_id = image_generation_batches.company_id
        AND pcu.role IN ('editor', 'approver', 'admin')
    )
  );

-- ─── Extend image_generation_jobs (created in 0159) ─────────────────────────

-- batch_id FK — nullable so B1-era standalone jobs stay valid.
ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES image_generation_batches(id) ON DELETE SET NULL;

-- Per §1.7: the aspect ratio this job was generated for.
-- Used by auto-attach (B4) to match image → platform variant.
ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS target_platforms JSONB;          -- array of platform codes, e.g. ["linkedin", "instagram"]

-- Per §1.5: populated by C4 from the source row's publish_date.
ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS target_publish_date DATE;        -- auto-attach date; null = no auto-attach

-- UI grouping (D2): which row of the source document this job came from.
ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS parent_post_index INT;           -- 0-based row index within the batch

-- Partial index for batch-level queries: which jobs in a batch need attention.
CREATE INDEX IF NOT EXISTS idx_image_generation_jobs_batch_state
  ON image_generation_jobs(batch_id, state)
  WHERE batch_id IS NOT NULL;
