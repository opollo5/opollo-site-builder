-- Migration 0157: Soft-delete all V1 social post data.
--
-- WRITE-SAFETY-CRITICAL — do NOT run this migration until:
--   1. The V1→V2 backfill (PR-04 / migration 0153-tier) has been verified
--      complete in production (all social_post_master rows have a corresponding
--      social_post_drafts row via the backfill script).
--   2. Steven has reviewed and confirmed the V2 dual-lookup code (PR-11 through
--      PR-15) is serving correct data in production.
--
-- What this does:
--   - Sets deleted_at = NOW() on all social_post_master rows where deleted_at
--     IS NULL. After this, all V1 queries (which filter IS NULL) return zero
--     rows. V2 analytics / calendar / webhook paths (already in dual-lookup
--     mode) continue to serve data from social_post_drafts.
--   - Sets deleted_at = NOW() on all social_post_variant rows similarly.
--   - Cancels all open social_schedule_entries (V1 QStash pipeline retired
--     in PR-13; the V2 publish-due cron handles all future publishes).
--
-- Rollback:
--   UPDATE social_post_master SET deleted_at = NULL
--     WHERE deleted_at >= '<migration_run_timestamp>';
--   UPDATE social_post_variant SET deleted_at = NULL
--     WHERE deleted_at >= '<migration_run_timestamp>';
--   UPDATE social_schedule_entries SET cancelled_at = NULL
--     WHERE cancelled_at >= '<migration_run_timestamp>';
--   (Replace <migration_run_timestamp> with the value seen in pg_stat_activity
--    or the Supabase migration run log.)
--
-- Next step: migration 0158_v1_table_drop.sql (PR-17) — drop V1 tables entirely.
--            Run only after verifying production behaviour post-0157.

BEGIN;

-- Soft-delete all V1 post master rows not already deleted
UPDATE social_post_master
   SET deleted_at = NOW()
 WHERE deleted_at IS NULL;

-- Soft-delete all V1 post variant rows not already deleted
UPDATE social_post_variant
   SET deleted_at = NOW()
 WHERE deleted_at IS NULL;

-- Cancel all open V1 schedule entries
-- (QStash pipeline retired in pr-13; no new entries are expected here)
UPDATE social_schedule_entries
   SET cancelled_at = NOW()
 WHERE cancelled_at IS NULL;

COMMIT;
