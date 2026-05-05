-- 0097 — Lock out pending_msp_release state on social_post_master.
--
-- The pending_msp_release state was added in 0070 for a planned MSP
-- review workflow that was never implemented. No code path has ever
-- set this state; no rows carry it in any environment.
--
-- This migration:
--   1. Fails loudly if any live rows carry the state (safety net).
--   2. Adds a CHECK constraint so the state can no longer be set via
--      any code path, even if application code were accidentally
--      re-introduced.
--
-- Reversibility: to re-enable, run:
--   ALTER TABLE social_post_master DROP CONSTRAINT social_post_master_no_msp_release;
-- Then restore the releasePost transition, the release API route
-- (app/api/platform/social/posts/[id]/release/route.ts), and the
-- component references removed in the same PR.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM social_post_master WHERE state::text = 'pending_msp_release'
  ) THEN
    RAISE EXCEPTION
      'Migration 0097 aborted: live rows in social_post_master carry state=pending_msp_release. '
      'Resolve those rows manually before re-running.';
  END IF;
END $$;

ALTER TABLE social_post_master
  ADD CONSTRAINT social_post_master_no_msp_release
  CHECK (state::text <> 'pending_msp_release');

COMMIT;
