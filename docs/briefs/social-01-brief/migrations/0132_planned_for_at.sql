-- Migration 0132: planned_for_at column + state machine constraint
-- Adds the save-as-draft "planned for" hint and locks the canonical state enum.
-- See docs/briefs/social-01/composer/SCHEMA.md §3

BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN planned_for_at timestamptz;

-- Partial index — most drafts won't have planned_for_at, only the "save as draft" tab uses it
CREATE INDEX idx_social_post_drafts_planned_for_at
  ON social_post_drafts(planned_for_at)
  WHERE state = 'draft' AND planned_for_at IS NOT NULL;

-- Lock the canonical state machine values.
-- If existing rows have states outside this set, this migration will fail —
-- fix them first with a data migration before running this one.
ALTER TABLE social_post_drafts
  ADD CONSTRAINT social_post_drafts_state_valid CHECK (
    state IN (
      'draft',
      'pending_approval',
      'rejected',
      'scheduled',
      'recurring',
      'paused',
      'publishing',
      'published',
      'failed'
    )
  );

COMMIT;
