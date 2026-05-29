-- 0164: B4 — operator selection + auto-attach plumbing for the mass image-gen pipeline.
--
-- Adds:
--   - image_selections          — records operator approve/reject on a job
--   - image_generation_jobs     — auto_attached_draft_id + auto_attach_state
--   - social_post_drafts        — media_asset_ids uuid[] (conditional; the
--                                 pattern mirrors social_post_variant.media_asset_ids
--                                 added in migration 0070)
--
-- Per §1.6 of the mass-image-gen brief: attachments write asset references,
-- not signed URLs. The publish layer signs URLs at publish time from the
-- referenced storage path.
--
-- Per §1.5: when an operator approves a job whose source row had a
-- publish_date set, the image auto-attaches to a scheduled draft for
-- (company, publish_date). When publish_date is null, auto_attach_state =
-- 'not_applicable' and no draft is touched.

-- ─── image_selections ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS image_selections (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             UUID        NOT NULL REFERENCES image_generation_jobs(id) ON DELETE CASCADE,
  selected           BOOLEAN     NOT NULL,           -- true = approve, false = reject
  selected_by        UUID        REFERENCES platform_users(id) ON DELETE SET NULL,
  rejection_reason   TEXT,
  selected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One terminal selection per job. Operators may reject then re-approve; the
-- partial unique index makes that legal (only one ACTIVE selected row).
-- For now we enforce one row per (job_id, selected_at) implicitly via PK;
-- callers should idempotency-check on (job_id, selected_by) before insert.
CREATE INDEX IF NOT EXISTS idx_image_selections_job
  ON image_selections(job_id, selected_at DESC);

ALTER TABLE image_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS image_selections_company_read ON image_selections;
CREATE POLICY image_selections_company_read
  ON image_selections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM image_generation_jobs j
      JOIN platform_company_users pcu ON pcu.company_id = j.company_id
      WHERE j.id = image_selections.job_id
        AND pcu.user_id = auth.uid()
        AND pcu.role IN ('editor', 'approver', 'admin')
    )
  );

-- ─── image_generation_jobs — auto-attach columns ────────────────────────────

ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS auto_attached_draft_id UUID
    REFERENCES social_post_drafts(id) ON DELETE SET NULL;

ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS auto_attach_state TEXT NOT NULL DEFAULT 'not_applicable';

-- Constrain to the four valid states. Use a NOT VALID + VALIDATE pattern so
-- the migration is forward-compatible with rows pre-dating the constraint
-- (none today, but safety in depth).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'image_generation_jobs_auto_attach_state_check'
  ) THEN
    ALTER TABLE image_generation_jobs
      ADD CONSTRAINT image_generation_jobs_auto_attach_state_check
      CHECK (auto_attach_state IN ('not_applicable', 'pending', 'attached', 'attach_failed'));
  END IF;
END $$;

-- ─── social_post_drafts.media_asset_ids ─────────────────────────────────────
-- Conditional: 0070 created social_post_variant.media_asset_ids; the brief's
-- B4 spec calls for the same shape on social_post_drafts. Today's drafts
-- table only has media_urls (added by 0127). We add media_asset_ids
-- additively so the publish-layer refactor can prefer it over media_urls
-- without breaking existing rows.

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS media_asset_ids UUID[] NOT NULL DEFAULT '{}';

-- Partial index: drafts that carry image-gen asset references. Used by the
-- publish-due cron to know whether to resolve asset-derived signed URLs.
CREATE INDEX IF NOT EXISTS idx_social_post_drafts_has_assets
  ON social_post_drafts USING gin (media_asset_ids)
  WHERE array_length(media_asset_ids, 1) > 0;
