-- Migration 0152: atomic claim for the publish-due cron.
--
-- The publish-due cron (app/api/internal/cron/publish-due/route.ts) does
-- SELECT-then-UPDATE on social_post_drafts to mark candidates as
-- state='publishing'. The two statements are independent — two
-- concurrent Vercel cron ticks (overlapping when a tick runs >60s, or
-- when manual triggers race the schedule) can both SELECT the same row
-- and both proceed to publish. That double-bills bundle.social and
-- emits the same post twice.
--
-- The fix wraps SELECT + UPDATE in a single transaction with
-- FOR UPDATE SKIP LOCKED, mirroring the brief-runner pattern in
-- lib/brief-runner.ts:286-318. Concurrent ticks see disjoint row sets.
--
-- Schema additions:
--   publish_claimed_at — set when state transitions scheduled→publishing.
--     Drives stale-claim recovery (if a worker dies mid-flight, the row
--     stays in 'publishing' with an old claim_at; a follow-up reaper can
--     revert based on this column).
--   publish_worker_id — diagnostic only; identifies the runtime that
--     claimed the row. Matches brief_runs.worker_id semantics.
--
-- Partial index on (state, scheduled_at) WHERE state='scheduled' supports
-- the FOR UPDATE SKIP LOCKED candidate scan.

BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS publish_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_worker_id  TEXT;

-- Partial index for the cron's claim scan. Excludes terminal states so it
-- stays narrow regardless of how many published/failed rows accumulate.
CREATE INDEX IF NOT EXISTS idx_social_post_drafts_scheduled_for_claim
  ON social_post_drafts (scheduled_at)
  WHERE state = 'scheduled' AND archived_at IS NULL;

COMMIT;
