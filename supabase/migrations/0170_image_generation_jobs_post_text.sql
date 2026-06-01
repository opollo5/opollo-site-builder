-- Migration 0170: Add post_text to image_generation_jobs
--
-- Stores the AI-generated social caption (from interpretPosts()) alongside
-- each image generation job so that auto-attach can pre-fill
-- social_post_drafts.content instead of creating a shell with content=''.
--
-- Design decisions:
--   - Nullable: template jobs, mood board, and manual dispatches have no
--     caption. NULL is the correct sentinel — auto-attach treats it as "no
--     caption available" and falls back to content=''.
--   - Not in generation_params JSONB: JSONB is for image rendering config;
--     a caption is post metadata. Keeping them separate avoids coupling
--     image rendering to social publishing concerns.
--   - No backfill: all existing jobs get NULL (correct — we cannot recover
--     captions that were never stored).
--   - Online-safe: ADD COLUMN with a nullable type acquires no row-level
--     lock in Postgres. Zero-downtime.

ALTER TABLE image_generation_jobs
  ADD COLUMN IF NOT EXISTS post_text TEXT NULL;

COMMENT ON COLUMN image_generation_jobs.post_text IS
  'AI-generated social caption from the Ideogram ingest path (interpretPosts). '
  'NULL for template jobs, mood-board jobs, and any job dispatched without a source post. '
  'Written to social_post_drafts.content on auto-attach (creation only, never overwritten).';
