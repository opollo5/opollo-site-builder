-- Migration 0136: Composer columns missed in PR A
-- batch_id  — groups rows created in one bulk CSV upload; used by rate limiter
-- recurrence_starting_at / recurrence_until — RRULE bounds for recurring posts

BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS batch_id              uuid,
  ADD COLUMN IF NOT EXISTS recurrence_starting_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurrence_until       timestamptz;

CREATE INDEX IF NOT EXISTS idx_social_post_drafts_batch_id
  ON social_post_drafts(batch_id)
  WHERE batch_id IS NOT NULL;

COMMIT;
