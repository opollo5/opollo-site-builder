-- Migration 0131: Recurring drafts support
-- Adds parent/child structure for recurring scheduled posts.
-- See docs/briefs/social-01/composer/SCHEMA.md §2

BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN parent_draft_id uuid REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  ADD COLUMN recurrence_rule text,
  ADD COLUMN recurrence_state text,
  ADD COLUMN occurrence_index integer;

-- Either a recurring parent, a child of one, or neither — never both at once
ALTER TABLE social_post_drafts
  ADD CONSTRAINT social_post_drafts_recurrence_shape CHECK (
    (parent_draft_id IS NULL AND recurrence_rule IS NULL)                                 -- normal row
    OR (parent_draft_id IS NULL AND recurrence_rule IS NOT NULL)                          -- recurring parent
    OR (parent_draft_id IS NOT NULL AND recurrence_rule IS NULL)                          -- recurring child
  );

ALTER TABLE social_post_drafts
  ADD CONSTRAINT social_post_drafts_recurrence_state_valid CHECK (
    recurrence_state IS NULL OR recurrence_state IN ('active', 'paused', 'ended')
  );

CREATE INDEX idx_social_post_drafts_parent_id
  ON social_post_drafts(parent_draft_id)
  WHERE parent_draft_id IS NOT NULL;

COMMIT;
