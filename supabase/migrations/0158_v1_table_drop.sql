-- Migration 0158: Drop all V1 social posting tables.
--
-- =========================================================================
-- WRITE-SAFETY-CRITICAL — HARD PREREQUISITES (ALL must be met):
-- =========================================================================
--
-- 1. Migration 0157_v1_soft_delete (PR-16) merged and verified in production:
--    all social_post_master + social_post_variant rows have deleted_at set,
--    and all social_schedule_entries rows have cancelled_at set.
--
-- 2. V1→V2 backfill (PR-04 / PR #1103) verified complete:
--    every V1 post has a corresponding social_post_drafts row.
--
-- 3. Code cleanup pass completed (separate PR, NOT included here):
--    All 68+ TypeScript files still referencing V1 tables must be updated
--    or their V1 code paths removed. Key files:
--      lib/platform/social/posts/*.ts         (create, list, get, update, delete, transitions)
--      lib/platform/social/variants/*.ts      (list, upsert)
--      lib/platform/social/publishing/*.ts    (fire, retry, watchdog, backfill)
--      lib/platform/social/approvals/        (record decisions via social_approval_requests)
--      lib/platform/social/analytics.ts      (V1 count queries)
--      lib/insights/source-attribution.ts    (V1 traversal chain)
--      app/viewer/[token]/page.tsx           (V1 post snapshot display)
--    Note: scheduli/ng, analytics, webhook, calendar already have V2 fallback
--    from PR-11 through PR-15. The remaining files need V2 equivalents first.
--
-- 4. All integration tests updated to NOT use social_post_master, social_post_variant,
--    social_schedule_entries, social_publish_attempts, or social_publish_jobs.
--    At least 30 integration test files currently seed V1 data.
--
-- 5. Smoke suite passes post-deploy of the code-cleanup PR.
--
-- =========================================================================
-- Tables dropped (dependency order):
-- =========================================================================
--   social_publish_attempts → social_publish_jobs → social_schedule_entries
--   → social_post_variant → social_post_master
--
-- Also drops (via CASCADE):
--   - social_post_master_active VIEW
--   - social_post_variant_active VIEW
--   - social_approval_requests (references social_post_master)
--   - social_approval_recipients (child of social_approval_requests)
--   - All RLS policies on above tables
--   - All indexes on above tables
--
-- Rollback: there is no clean rollback. Restore from backup.
-- =========================================================================

BEGIN;

-- Drop views first (avoids confusing CASCADE output)
DROP VIEW IF EXISTS social_post_master_active;
DROP VIEW IF EXISTS social_post_variant_active;

-- Drop leaf tables first (avoid FK dependency errors without CASCADE)
DROP TABLE IF EXISTS social_publish_attempts CASCADE;
DROP TABLE IF EXISTS social_publish_jobs CASCADE;
DROP TABLE IF EXISTS social_schedule_entries CASCADE;
DROP TABLE IF EXISTS social_approval_recipients CASCADE;
DROP TABLE IF EXISTS social_approval_requests CASCADE;
DROP TABLE IF EXISTS social_post_variant CASCADE;
DROP TABLE IF EXISTS social_post_master CASCADE;

COMMIT;
