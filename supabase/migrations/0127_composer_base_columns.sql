-- Migration 0127: Social composer base columns for social_post_drafts
--
-- BRIEF DEFECT NOTE: The social-01-brief/composer/SCHEMA.md §1 describes
-- social_post_drafts as already having columns state, content, media_urls,
-- target_profiles, platform_variants, scheduled_at, approval_required,
-- approver_user_id — but migration 0112 created the table with a JSONB blob
-- design (draft_data). This migration adds those columns additively so that
-- migrations 0131-0135 (which reference state, planned_for_at etc.) work.
--
-- Existing JSONB draft_data rows are preserved. The new column-per-field
-- approach is used by the new composer; the old JSONB approach is used by
-- the existing poster (Spec 22). Both coexist during the cutover period.
--
-- CLAUDE-ASSUMPTION: created_by_user_id per brief = existing created_by column.
-- No rename; TypeScript layer maps created_by → created_by_user_id.

BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS state               text        NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS content             text        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_urls          text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_profiles     jsonb       NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS platform_variants   jsonb       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS approval_required   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approver_user_id    uuid        REFERENCES auth.users(id);

-- Partial index: fast lookup of drafts due for publishing
CREATE INDEX IF NOT EXISTS idx_social_post_drafts_scheduled
  ON social_post_drafts(scheduled_at)
  WHERE state = 'scheduled' AND scheduled_at IS NOT NULL;

-- Partial index: fast lookup of pending approval drafts
CREATE INDEX IF NOT EXISTS idx_social_post_drafts_pending_approval
  ON social_post_drafts(created_at DESC)
  WHERE state = 'pending_approval';

COMMIT;
