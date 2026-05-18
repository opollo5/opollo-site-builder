-- Migration 0133: published metadata for already-published posts
-- Used by the analytics modal and the dashboard's "Open post" action.
-- See docs/briefs/social-01/composer/SCHEMA.md §4

BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN published_at timestamptz,
  ADD COLUMN published_url text,
  ADD COLUMN last_publish_error jsonb,
  ADD COLUMN publish_attempts integer NOT NULL DEFAULT 0;

-- Index for the dashboard's "recently published" sort
CREATE INDEX idx_social_post_drafts_published_at
  ON social_post_drafts(published_at DESC)
  WHERE state = 'published' AND published_at IS NOT NULL;

COMMIT;
